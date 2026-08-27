//go:build android

package main

import "tailscale.com/net/netmon"

func setDefaultRoute(interfaceName, gateway string) {
	netmon.UpdateLastKnownDefaultRouteInterface(interfaceName)
	netmon.UpdateLastKnownDefaultGateway(gateway)
}
