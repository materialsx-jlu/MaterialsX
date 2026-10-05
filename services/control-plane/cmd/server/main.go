package main

import (
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"

	"github.com/jamip/materialsx/control-plane/internal/billing"
	"github.com/jamip/materialsx/control-plane/internal/httpapi"
)

func main() {
	address := env("MATERIALSX_CONTROL_ADDR", "127.0.0.1:8787")
	if !developmentAllowed(os.Getenv("MATERIALSX_ENV"), os.Getenv("MATERIALSX_DEV_MODE"), address) {
		log.Fatal("legacy control plane requires explicit development mode and loopback binding")
	}
	dataDir := env("MATERIALSX_CONTROL_DATA", filepath.Join("runtime", "m3-control-plane"))
	store, err := billing.NewStore(filepath.Join(dataDir, "state.json"))
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{
		Addr:              address,
		Handler:           httpapi.New(store, os.Getenv("MATERIALSX_DEV_MODE") == "1").Handler(),
		ReadHeaderTimeout: 5_000_000_000,
	}
	log.Printf("MaterialsX control plane listening on http://%s", address)
	log.Fatal(server.ListenAndServe())
}

func developmentAllowed(environment, mode, address string) bool {
	host, _, e := net.SplitHostPort(address)
	return environment != "production" && (environment == "" || environment == "development") && mode == "1" && e == nil && net.ParseIP(host) != nil && net.ParseIP(host).IsLoopback()
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
