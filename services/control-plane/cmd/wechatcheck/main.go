// wechatcheck is a read-only, offline merchant configuration preflight.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/jamip/materialsx/control-plane/internal/payments"
)

func main() {
	config := flag.String("config", "", "Absolute path to private weixin runtime YAML")
	dir := flag.String("runtime-dir", "", "Absolute runtime directory for relative PEM paths")
	origin := flag.String("origin", os.Getenv("MATERIALSX_IDENTITY_PUBLIC_URL"), "MaterialsX independent HTTPS identity origin (no path)")
	id := flag.String("public-key-id", "", "Wechat PUB_KEY_ID_ identifier (not a secret)")
	output := flag.String("output", "", "Optional new private JSON report (refuses overwrite)")
	merchantOnly := flag.Bool("merchant-only", false, "Exit based on local merchant configuration only; deployment gates remain closed")
	flag.Parse()
	if flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "Unexpected positional arguments")
		os.Exit(1)
	}
	override := map[string]string{}
	if *config != "" {
		override["MATERIALSX_WECHAT_CONFIG_PATH"] = *config
	}
	if *dir != "" {
		override["MATERIALSX_WECHAT_RUNTIME_DIR"] = *dir
	}
	if *id != "" {
		override["WECHAT_PAY_PUBLIC_KEY_ID"] = *id
	}
	get := func(name string) string {
		if v, ok := override[name]; ok {
			return v
		}
		return os.Getenv(name)
	}
	report := payments.WechatPreflight(get, *origin)
	b, e := json.MarshalIndent(report, "", "  ")
	if e != nil {
		os.Exit(1)
	}
	b = append(b, '\n')
	if *output != "" {
		if !filepath.IsAbs(*output) {
			fmt.Fprintln(os.Stderr, "Report path must be absolute")
			os.Exit(1)
		}
		f, e := os.OpenFile(*output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			fmt.Fprintln(os.Stderr, "Cannot create new private report")
			os.Exit(1)
		}
		_, e = f.Write(b)
		ce := f.Close()
		if e != nil || ce != nil {
			fmt.Fprintln(os.Stderr, "Cannot write report")
			os.Exit(1)
		}
	}
	fmt.Print(string(b))
	if (!*merchantOnly && !report.OfflineConfigReady) || (*merchantOnly && !report.MerchantConfigReady) {
		os.Exit(2)
	}
}
