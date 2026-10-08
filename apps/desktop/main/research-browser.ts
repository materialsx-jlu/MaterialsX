import { BrowserWindow, session, nativeImage, type DownloadItem } from 'electron';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { browserAction, type BrowserAsset } from '../../../packages/contracts/src/agent-workspace.js';
import { browserUrl, verifyBrowserHost, publicSourceUrl } from '../../../packages/agent/src/browser-policy.js';
import { writeScientificFiles } from '../../../packages/agent/src/scientific-artifacts.js';
import { readOwnedBytes } from '../../../packages/atomistic/src/artifact-io.js';
import type { WorkspaceStore } from './store.js';
const MAX = 8 * 1024 * 1024;
type Page = {
    window: BrowserWindow;
    links: Array<{
        href: string;
        text: string;
    }>;
    url: string;
    busy: boolean;
    download?: {
        url: string;
        resolve: (item: DownloadItem) => void;
        reject: (error: Error) => void;
    } | undefined;
};
/** A sandboxed, project-specific Chromium session. No login tokens, cookies or arbitrary JS tools are exported. */
export class ResearchBrowser {
    private pages = new Map<string, Page>();
    constructor(private store: WorkspaceStore, private userData: string, private fixtureOrigin?: string) { }
    private project(id: string) { const p = this.store.getProject(id); if (!p)
        throw Error('PROJECT_NOT_OWNED'); return p; }
    state(id: string) { const page = this.pages.get(id); return { open: !!page && !page.window.isDestroyed(), url: page && !page.window.isDestroyed() ? publicSourceUrl(page.window.webContents.getURL() || page.url) : null }; }
    private async url(id: string, value: string) { const u = browserUrl(value, this.store.agentWorkspace.policy(id).origins, this.fixtureOrigin); await verifyBrowserHost(u, this.fixtureOrigin); return u; }
    private async page(id: string, value: string) {
        this.project(id);
        await this.url(id, value);
        let p = this.pages.get(id);
        if (p && !p.window.isDestroyed())
            return p;
        const ses = session.fromPartition('materialsx-browser-' + id, { cache: false });
        ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));
        ses.setPermissionCheckHandler(() => false);
        ses.webRequest.onBeforeRequest((details, cb) => { if (details.url === 'about:blank') {
            cb({ cancel: false });
            return;
        } void this.url(id, details.url).then(() => cb({ cancel: false }), () => cb({ cancel: true })); });
        const win = new BrowserWindow({ width: 1100, height: 780, show: true, title: 'MaterialsX · Research browser', webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false, allowRunningInsecureContent: false } });
        p = { window: win, links: [], url: value, busy: false };
        this.pages.set(id, p);
        const owned = p;
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.on('will-attach-webview', event => event.preventDefault());
        win.webContents.on('will-navigate', (event, url) => { try {
            browserUrl(url, this.store.agentWorkspace.policy(id).origins, this.fixtureOrigin);
        }
        catch {
            event.preventDefault();
        } });
        win.webContents.on('will-redirect', (event, url) => { try {
            browserUrl(url, this.store.agentWorkspace.policy(id).origins, this.fixtureOrigin);
        }
        catch {
            event.preventDefault();
        } });
        const onDownload = (event: Electron.Event, item: DownloadItem, contents: Electron.WebContents) => {
            const request = owned.download;
            if (contents !== win.webContents || !request) {
                event.preventDefault();
                return;
            }
            if (request.url !== item.getURL() || item.getTotalBytes() > MAX || item.getURLChain().some(url => { try {
                browserUrl(url, this.store.agentWorkspace.policy(id).origins, this.fixtureOrigin);
                return false;
            }
            catch {
                return true;
            } })) {
                event.preventDefault();
                owned.download = undefined;
                request.reject(Error('BROWSER_DOWNLOAD_DENIED'));
                return;
            }
            owned.download = undefined;
            request.resolve(item);
        };
        ses.on('will-download', onDownload);
        win.on('closed', () => { ses.removeListener('will-download', onDownload); owned.download?.reject(Error('BROWSER_CLOSED')); owned.download = undefined; this.pages.delete(id); });
        return p;
    }
    private async asset(id: string, taskId: string | null, kind: BrowserAsset['kind'], bytes: Buffer, mime: string, source: string, modelConnectionId: string | null = null, pixelInputSha256: string | null = null) {
        if (bytes.length > MAX)
            throw Error('BROWSER_ASSET_SIZE_LIMIT');
        const p = this.project(id), assetId = randomUUID();
        const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : mime === 'application/pdf' ? 'pdf' : kind === 'visual-report' ? 'md' : 'txt';
        const [file] = await writeScientificFiles(p.path, assetId, [{ name: kind + '.' + ext, body: bytes }]);
        return this.store.agentWorkspace.saveAsset({ id: assetId, projectId: id, taskId, kind, ...file!, mime, sourceUrl: publicSourceUrl(source), createdAt: new Date().toISOString(), modelConnectionId, pixelInputSha256 });
    }
    private async navigate(page:Page,url:string,signal?:AbortSignal){
      let timer:ReturnType<typeof setTimeout>|undefined;let abort:(()=>void)|undefined;
      try{await Promise.race([page.window.webContents.loadURL(url),new Promise<never>((_resolve,reject)=>{abort=()=>reject(Error('BROWSER_NAVIGATION_CANCELLED'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();timer=setTimeout(()=>{page.window.webContents.stop();reject(Error('BROWSER_NAVIGATION_TIMEOUT'));},30000);})]);}
      finally{if(timer)clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);}
    }
    async act(id: string, input: unknown, signal?: AbortSignal, taskId: string | null = null) {
        const q = browserAction.parse(input);
        signal?.throwIfAborted();
        this.project(id);
        if (q.action === 'inspect_image')
            throw Error('USE_SUPERVISED_VISUAL_TOOL');
        const p = q.action === 'open' && q.url ? await this.page(id, q.url) : this.pages.get(id);
        if (!p || p.window.isDestroyed())
            throw Error('BROWSER_NOT_OPEN');
        if (p.busy)
            throw Error('BROWSER_OPERATION_IN_FLIGHT');
        p.busy = true;
        const abort = () => p.window.webContents.stop();
        signal?.addEventListener('abort', abort, { once: true });
        try {
            const wc = p.window.webContents;
            if (q.action === 'open') {
                if (!q.url)
                    throw Error('BROWSER_URL_REQUIRED');
                await this.url(id, q.url);
                await this.navigate(p,q.url,signal);
                p.links = [];
                p.url = wc.getURL();
            }
            await this.url(id, wc.getURL());
            if (q.action === 'read') {
                const data = await wc.executeJavaScript(`(()=>({text:document.body.innerText.slice(0,16000),links:Array.from(document.querySelectorAll('a[href]')).filter(a=>a.getClientRects().length).slice(0,60).map(a=>({href:a.href,text:a.innerText.slice(0,140)}))}))()`);
                p.url = wc.getURL();
                p.links = data.links.filter((link: {
                    href: string;
                }) => { try {
                    browserUrl(link.href, this.store.agentWorkspace.policy(id).origins, this.fixtureOrigin);
                    return true;
                }
                catch {
                    return false;
                } });
                return { sourceUrl: publicSourceUrl(p.url), untrustedPageContent: true, text: data.text, links: p.links.map((link, index) => ({ selector: 'link:' + index, text: link.text, url: publicSourceUrl(link.href) })), pixelsRead: false };
            }
            if (q.action === 'click') {
                const match = /^link:(\d+)$/.exec(q.selector ?? ''), link = match && p.links[Number(match[1])];
                if (!link || p.url !== wc.getURL())
                    throw Error('BROWSER_READ_LINKS_FIRST');
                await this.url(id, link.href);
                await this.navigate(p,link.href,signal);
                p.links = [];
                p.url = wc.getURL();
            }
            if (q.action === 'scroll') {
                await wc.executeJavaScript('window.scrollBy(0,' + (q.dy ?? 600) + ')');
                return this.state(id);
            }
            if (q.action === 'screenshot') {
                const image = await wc.capturePage();
                signal?.throwIfAborted();
                return this.asset(id, taskId, 'screenshot', image.toPNG(), 'image/png', wc.getURL());
            }
            if (q.action === 'download') {
                if (!q.url)
                    throw Error('BROWSER_URL_REQUIRED');
                await this.url(id, q.url);
                return await this.download(id, p, q.url, signal, taskId);
            }
            signal?.throwIfAborted();
            return this.state(id);
        }
        finally {
            p.busy = false;
            signal?.removeEventListener('abort', abort);
        }
    }
    private async download(id: string, p: Page, url: string, signal: AbortSignal | undefined, taskId: string | null) {
        const dir = join(this.userData, 'browser-downloads', randomUUID());
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const path = join(dir, 'download');
        let item: DownloadItem | undefined;
        const deadline = AbortSignal.timeout(45000), combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
        try {
            const result = await new Promise<DownloadItem>((resolve, reject) => {
                const abort = () => { item?.cancel(); p.download = undefined; reject(Error('BROWSER_DOWNLOAD_CANCELLED')); };
                combined.addEventListener('abort', abort, { once: true });
                p.download = { url, reject: error => { combined.removeEventListener('abort', abort); reject(error); }, resolve: i => { item = i; i.setSavePath(path); i.on('updated', () => { if (i.getReceivedBytes() > MAX)
                        i.cancel(); }); i.once('done', (_e, state) => { combined.removeEventListener('abort', abort); state === 'completed' ? resolve(i) : reject(Error('BROWSER_DOWNLOAD_' + state)); }); } };
                p.window.webContents.downloadURL(url);
            });
            combined.throwIfAborted();
            const bytes = await readOwnedBytes(dir, path, null, MAX);
            let mime = result.getMimeType().split(';')[0]!;
            if (bytes.subarray(0, 5).toString() === '%PDF-')
                mime = 'application/pdf';
            else if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
                mime = 'image/png';
            else if (bytes[0] === 255 && bytes[1] === 216)
                mime = 'image/jpeg';
            else if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
                mime = 'image/webp';
            else {
                const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
                if (bytes.length > 512 * 1024 || text.includes('\0'))
                    throw Error('BROWSER_DOWNLOAD_FORMAT_UNSUPPORTED');
                mime = 'text/plain';
            }
            return this.asset(id, taskId, 'download', bytes, mime, url);
        }
        finally {
            p.download = undefined;
            item?.cancel();
            await rm(dir, { recursive: true, force: true });
        }
    }
    async preview(id: string, assetId: string) {
        const asset = this.store.agentWorkspace.assets(id).find(a => a.id === assetId);
        if (!asset)
            throw Error('BROWSER_ASSET_NOT_OWNED');
        const bytes = await readOwnedBytes(this.project(id).path, join(this.project(id).path, asset.path), asset.sha256, MAX);
        if (asset.mime.startsWith('image/'))
            return { kind: 'image' as const, content: 'data:' + asset.mime + ';base64,' + bytes.toString('base64') };
        if (asset.mime === 'application/pdf')
            throw Error('PDF_PREVIEW_USE_PAPER_LIBRARY');
        return { kind: 'text' as const, content: bytes.toString('utf8') };
    }
    async pixels(id: string, assetId: string, maxBytes = 256 * 1024) {
        const asset = this.store.agentWorkspace.assets(id).find(a => a.id === assetId);
        if (!asset || !asset.mime.startsWith('image/'))
            throw Error('IMAGE_ASSET_NOT_OWNED');
        const root = this.project(id).path, bytes = await readOwnedBytes(root, join(root, asset.path), asset.sha256, MAX), image = nativeImage.createFromBuffer(bytes);
        const size = image.getSize();
        if (image.isEmpty() || size.width * size.height > 16000000)
            throw Error('IMAGE_DIMENSIONS_UNSUPPORTED');
        let edge = Math.min(768, Math.max(size.width, size.height)), resized = image.resize(size.width >= size.height ? { width: edge } : { height: edge }), pixels = resized.toJPEG(75);
        while (pixels.length > maxBytes && edge > 192) {
            edge = Math.max(192, Math.floor(edge * 0.75));
            resized = image.resize(size.width >= size.height ? { width: edge } : { height: edge });
            pixels = resized.toJPEG(65);
        }
        if (pixels.length > maxBytes)
            throw Error('IMAGE_CONTEXT_CAPACITY_TOO_SMALL');
        return { asset, bytes: pixels, width: resized.getSize().width, height: resized.getSize().height, sha256: createHash('sha256').update(pixels).digest('hex') };
    }
    async visualReport(id: string, taskId: string, asset: BrowserAsset, text: string, connectionId: string, pixelSha256: string) { return this.asset(id, taskId, 'visual-report', Buffer.from('# Image inspection\n\n' + text + '\n\nSource image SHA256: ' + asset.sha256 + '\nPixel input SHA256: ' + pixelSha256 + '\nModel: ' + connectionId + '\nScientific conclusions need review.\n'), 'text/markdown', asset.sourceUrl, connectionId, pixelSha256); }
    async close(id: string, clear = false) { const p = this.pages.get(id); if (p && !p.window.isDestroyed())
        p.window.destroy(); this.pages.delete(id); if (clear)
        await session.fromPartition('materialsx-browser-' + id).clearStorageData(); }
    async dispose() { for (const id of [...this.pages.keys()])
        await this.close(id, true); }
}
