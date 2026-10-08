# UA.13 同源团队网关部署模板

模板不包含证书、Token、账户或真实源数据。部署前选择真实域名和生产 M5 服务；不把 localhost 开发身份映射成生产身份。

同一 HTTPS 网关：原 M5 服务 127.0.0.1:8788；团队服务 127.0.0.1:8793；MOOS MCP 和源后台仅留服务器本机。M5 生产 `/health` 必须返回 `production:true`，原账户状态与设备撤销即时适用。

```nginx
server {
    listen 443 ssl;
    server_name api.materialsx.example;
    ssl_certificate /absolute/private/fullchain.pem;
    ssl_certificate_key /absolute/private/privkey.pem;
    client_max_body_size 128k;

    location /v1/research/ {
        proxy_pass http://127.0.0.1:8793;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Origin $http_origin;
        proxy_set_header Cookie "";
        proxy_buffering off;
        proxy_read_timeout 35s;
    }
    location / {
        proxy_pass http://127.0.0.1:8788;
        proxy_set_header Host $host;
    }
}
```

团队服务的公开 origin 和身份 origin 均为 `https://api.materialsx.example`；`MATERIALSX_TEAM_TRUSTED_LOOPBACK_PROXY=1`，开发开关保持关闭。代理保留原 Origin，错误 Origin/Host 或伪造身份头会被拒绝。部署模板尚未在用户的公网服务器运行。

团队数据库由服务账户独占，目录 0700、文件 0600，不能映射到静态文件目录；初始化授权使用私有 JSON。备份时协调 SQLite WAL（使用 SQLite 备份 API 或停止服务后完整备份），与原 M5 账户库/审计和 MOOS 来源备份分别管理。操作日志不对公众开放。

不使用跳过 TLS 证书校验、跨域转发 M5 Token、公开 MOOS 底层 localhost API、数据库直连修改数据等方式解决配置问题。
