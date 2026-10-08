package main

import "testing"

func TestLegacyServiceRequiresExplicitLoopbackDevelopment(t *testing.T) {
	for _, v := range []struct {
		env, mode, addr string
		allowed         bool
	}{
		{"", "1", "127.0.0.1:8787", true}, {"development", "1", "[::1]:8787", true},
		{"production", "1", "127.0.0.1:8787", false}, {"", "0", "127.0.0.1:8787", false},
		{"development", "1", "0.0.0.0:8787", false}, {"development", "1", "example.invalid:8787", false},
	} {
		if developmentAllowed(v.env, v.mode, v.addr) != v.allowed {
			t.Fatal("unsafe legacy environment allowed")
		}
	}
}
