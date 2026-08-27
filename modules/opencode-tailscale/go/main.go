package main

/*
#include <stdlib.h>
#ifdef __ANDROID__
#include <android/log.h>

static void logToAndroid(const char* message) {
	__android_log_write(ANDROID_LOG_INFO, "OpenCodeTsnet", message);
}
#else
static void logToAndroid(const char* message) {}
#endif
*/
import "C"

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
	"unsafe"

	"tailscale.com/client/local"
	"tailscale.com/ipn"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/net/netmon"
	"tailscale.com/tsnet"
)

const (
	startupTimeout      = 60 * time.Second
	controlPlaneTimeout = 15 * time.Second
)

type status struct {
	State               string `json:"state"`
	BaseURL             string `json:"baseUrl,omitempty"`
	Hostname            string `json:"hostname,omitempty"`
	TailnetIPv4         string `json:"tailnetIPv4,omitempty"`
	TailnetIPv6         string `json:"tailnetIPv6,omitempty"`
	RemoteHost          string `json:"remoteHost,omitempty"`
	RemotePort          int    `json:"remotePort,omitempty"`
	LoginURL            string `json:"loginUrl,omitempty"`
	Auth                auth   `json:"auth,omitempty"`
	Phase               string `json:"phase,omitempty"`
	NetworkAvailable    bool   `json:"networkAvailable"`
	NetworkType         string `json:"networkType,omitempty"`
	LastNetworkChangeAt int64  `json:"lastNetworkChangeAt,omitempty"`
	ControlPlaneOnline  bool   `json:"controlPlaneOnline"`
	TailnetOnline       bool   `json:"tailnetOnline"`
	DiagnosticCode      string `json:"diagnosticCode,omitempty"`
	DiagnosticMessage   string `json:"diagnosticMessage,omitempty"`
	Error               string `json:"error,omitempty"`
}

type auth struct {
	Mode             string `json:"mode"`
	InteractiveLogin bool   `json:"interactiveLogin"`
}

type instance struct {
	server   *tsnet.Server
	listener net.Listener
	done     chan struct{}
	stateDir string
	hostname string
	cancel   context.CancelFunc
}

type androidInterface struct {
	Name      string   `json:"name"`
	Index     int      `json:"index"`
	Addresses []string `json:"addresses"`
}

var state = struct {
	sync.Mutex
	instance *instance
	status   status
}{status: status{State: "stopped"}}

var interfaces = struct {
	sync.RWMutex
	values []netmon.Interface
}{}

//export TailscaleStart
func TailscaleStart(stateDir, hostname, remoteHost *C.char, remotePort C.int) *C.char {
	result := start(
		C.GoString(stateDir),
		C.GoString(hostname),
		C.GoString(remoteHost),
		int(remotePort),
	)
	return resultJSON(result)
}

//export TailscaleStop
func TailscaleStop() *C.char {
	state.Lock()
	stopLocked()
	result := state.status
	state.Unlock()
	return resultJSON(result)
}

//export TailscaleStatus
func TailscaleStatus() *C.char {
	state.Lock()
	if state.instance != nil && state.status.State == "needs_login" {
		client, err := state.instance.server.LocalClient()
		if err == nil {
			result, statusErr := statusWithTimeout(client)
			logStatus("status", result, statusErr)
			if statusErr == nil && result.BackendState == ipn.Running.String() {
				startRelayLocked(state.instance, state.instance.hostname, state.status.RemoteHost, state.status.RemotePort)
			}
		} else {
			logMessage("status: local client error: %v", err)
		}
	}
	result := state.status
	state.Unlock()
	return resultJSON(result)
}

//export TailscaleNetworkChanged
func TailscaleNetworkChanged(available C.int, networkType *C.char, at C.longlong) {
	logMessage("network: available=%t type=%s", available != 0, C.GoString(networkType))
	state.Lock()
	state.status.NetworkAvailable = available != 0
	state.status.NetworkType = C.GoString(networkType)
	state.status.LastNetworkChangeAt = int64(at)
	if !state.status.NetworkAvailable && state.status.State != "stopped" {
		state.status.Phase = "network_unavailable"
		state.status.DiagnosticCode = "network_unavailable"
		state.status.DiagnosticMessage = "Android reports no active network"
	}
	state.Unlock()
}

//export TailscaleSetInterfaces
func TailscaleSetInterfaces(value *C.char) {
	var android []androidInterface
	if err := json.Unmarshal([]byte(C.GoString(value)), &android); err != nil {
		return
	}
	values := make([]netmon.Interface, 0, len(android))
	for _, item := range android {
		if item.Name == "" || item.Index < 1 {
			continue
		}
		addrs := make([]net.Addr, 0, len(item.Addresses))
		for _, value := range item.Addresses {
			ip, network, err := net.ParseCIDR(value)
			if err == nil {
				network.IP = ip
				addrs = append(addrs, network)
			}
		}
		values = append(values, netmon.Interface{
			Interface: &net.Interface{Name: item.Name, Index: item.Index, Flags: net.FlagUp},
			AltAddrs:  addrs,
		})
	}
	interfaces.Lock()
	interfaces.values = values
	interfaces.Unlock()
}

//export TailscaleSetDefaultRoute
func TailscaleSetDefaultRoute(interfaceName, gateway *C.char) {
	logMessage("network: default route interface=%q gateway=%q", C.GoString(interfaceName), C.GoString(gateway))
	setDefaultRoute(C.GoString(interfaceName), C.GoString(gateway))
}

//export TailscaleFree
func TailscaleFree(value *C.char) {
	C.free(unsafe.Pointer(value))
}

func start(stateDir, hostname, remoteHost string, remotePort int) status {
	state.Lock()
	defer state.Unlock()

	if stateDir == "" || hostname == "" || remoteHost == "" || remotePort < 1 || remotePort > 65535 {
		return setErrorLocked(errors.New("invalid Tailscale proxy configuration"))
	}
	if state.instance != nil && state.instance.stateDir == stateDir && state.instance.hostname == hostname {
		client, err := state.instance.server.LocalClient()
		if err == nil {
			result, statusErr := statusWithTimeout(client)
			if statusErr == nil && result.BackendState == ipn.Running.String() {
				return startRelayLocked(state.instance, hostname, remoteHost, remotePort)
			}
			if state.status.State == "needs_login" && state.status.LoginURL != "" {
				state.status.RemoteHost = remoteHost
				state.status.RemotePort = remotePort
				return state.status
			}
		}
	}

	stopLocked()
	state.status = status{State: "starting", Phase: "starting", Hostname: hostname, RemoteHost: remoteHost, RemotePort: remotePort, Auth: auth{Mode: "interactive", InteractiveLogin: true}}

	server := &tsnet.Server{
		Dir:      stateDir,
		Hostname: hostname,
		// Login URLs are read from the structured LocalAPI/IPN bus, never logs.
		Logf: func(format string, args ...any) {
			logMessage("ts: "+format, args...)
		},
		UserLogf: func(format string, args ...any) {
			logMessage("ts-user: "+format, args...)
		},
	}
	if runtime.GOOS == "android" {
		// Android does not provide a usable process temp directory. Keep
		// Tailscale's log policy state alongside its app-private node state.
		if err := os.MkdirAll(stateDir, 0700); err != nil {
			return setErrorLocked(err)
		}
		if err := os.Setenv("TS_LOGS_DIR", stateDir); err != nil {
			return setErrorLocked(err)
		}
		// Android blocks the netlink query used by Go's net.Interfaces. Kotlin
		// supplies the app-visible interfaces and addresses before startup.
		netmon.RegisterInterfaceGetter(func() ([]netmon.Interface, error) {
			interfaces.RLock()
			defer interfaces.RUnlock()
			return append([]netmon.Interface(nil), interfaces.values...), nil
		})
		registerAndroidSocketBinder()
	}
	if err := server.Start(); err != nil {
		return setDiagnosticErrorLocked("control_plane_start_failed", "Tailscale control plane could not start", err)
	}

	client, err := server.LocalClient()
	if err != nil {
		_ = server.Close()
		return setDiagnosticErrorLocked("control_plane_client_failed", "Tailscale control plane client unavailable", err)
	}
	current := &instance{server: server, done: make(chan struct{}), stateDir: stateDir, hostname: hostname}
	state.instance = current
	currentStatus, err := statusWithTimeout(client)
	logStatus("start", currentStatus, err)
	if err != nil {
		stopLocked()
		return setDiagnosticErrorLocked("control_plane_status_failed", "Unable to read Tailscale control plane status", err)
	}
	if currentStatus.BackendState == ipn.Running.String() {
		state.status.ControlPlaneOnline = true
		state.status.TailnetOnline = len(currentStatus.TailscaleIPs) > 0
		return startRelayLocked(current, hostname, remoteHost, remotePort)
	}
	state.status.Phase = "control_plane"
	loginURL, err := startInteractiveLogin(client)
	if err != nil {
		stopLocked()
		return setDiagnosticErrorLocked("control_plane_login_failed", "Tailscale control plane login failed", err)
	}
	if loginURL != "" {
		state.status = status{State: "needs_login", Phase: "waiting_auth", Hostname: hostname, RemoteHost: remoteHost, RemotePort: remotePort, LoginURL: loginURL, Auth: auth{Mode: "interactive", InteractiveLogin: true}, DiagnosticCode: "auth_required", DiagnosticMessage: "Tailscale authorization is required"}
		// The browser does not call back into the app. Keep observing the local
		// control plane so getStatus reflects authorization as soon as tsnet does.
		go watchForRunning(current, hostname, remoteHost, remotePort)
		return state.status
	}
	return startRelayLocked(current, hostname, remoteHost, remotePort)
}

func statusWithTimeout(client *local.Client) (*ipnstate.Status, error) {
	ctx, cancel := context.WithTimeout(context.Background(), controlPlaneTimeout)
	defer cancel()
	return client.Status(ctx)
}

// Tailscale confirms browser authorization before its local control plane has
// necessarily reached Running. Reuse the pending instance while that final
// transition completes; restarting here creates another device identity.
func waitForRunningLocked(client *local.Client, current *instance, hostname, remoteHost string, remotePort int) status {
	deadline := time.Now().Add(startupTimeout)
	for time.Now().Before(deadline) {
		result, err := statusWithTimeout(client)
		logStatus("wait", result, err)
		if err == nil && result.BackendState == ipn.Running.String() {
			return startRelayLocked(current, hostname, remoteHost, remotePort)
		}
		time.Sleep(500 * time.Millisecond)
	}
	state.status.Phase = "waiting_auth"
	return state.status
}

func watchForRunning(current *instance, hostname, remoteHost string, remotePort int) {
	ctx, cancel := context.WithCancel(context.Background())
	state.Lock()
	if state.instance != current {
		state.Unlock()
		cancel()
		return
	}
	current.cancel = cancel
	state.Unlock()
	defer cancel()
	deadline := time.Now().Add(3 * time.Minute)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return
		default:
		}
		client, err := current.server.LocalClient()
		if err != nil {
			logMessage("watch: local client error: %v", err)
			time.Sleep(500 * time.Millisecond)
			continue
		}
		result, err := statusWithTimeout(client)
		logStatus("watch", result, err)
		if err != nil || result.BackendState != ipn.Running.String() {
			time.Sleep(500 * time.Millisecond)
			continue
		}
		state.Lock()
		if state.instance == current && state.status.State == "needs_login" {
			startRelayLocked(current, hostname, remoteHost, remotePort)
		}
		state.Unlock()
		return
	}
}

func startInteractiveLogin(client *local.Client) (string, error) {
	watchCtx, watchCancel := context.WithTimeout(context.Background(), startupTimeout)
	// tsnet.Server.Start already starts the interactive login when the backend
	// needs authentication. Subscribe here only to receive its URL; requesting
	// login a second time races the first flow and can leave the backend stuck in
	// Starting after browser authorization.
	watcher, err := client.WatchIPNBus(watchCtx, ipn.NotifyInitialState)
	if err != nil {
		watchCancel()
		return "", err
	}
	for {
		notify, err := watcher.Next()
		if err != nil {
			logMessage("login: watcher error: %v", err)
			_ = watcher.Close()
			watchCancel()
			return "", err
		}
		logMessage("login: notification state=%s browse=%t", notifyState(notify), notify.BrowseToURL != nil && *notify.BrowseToURL != "")
		if notify.BrowseToURL != nil && *notify.BrowseToURL != "" {
			logMessage("login: authorization URL received")
			_ = watcher.Close()
			watchCancel()
			return *notify.BrowseToURL, nil
		}
		if notify.State != nil && *notify.State == ipn.Running {
			logMessage("login: backend is running")
			_ = watcher.Close()
			watchCancel()
			return "", nil
		}
	}
}

func notifyState(notify ipn.Notify) string {
	if notify.State == nil {
		return "none"
	}
	return notify.State.String()
}

func startRelayLocked(current *instance, hostname, remoteHost string, remotePort int) status {
	if current.listener != nil && state.status.State == "ready" {
		return state.status
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		stopLocked()
		return setErrorLocked(err)
	}
	current.listener = listener
	logMessage("relay: listening for %s:%d", remoteHost, remotePort)
	go serve(current, remoteHost, remotePort)
	ip4, ip6 := current.server.TailscaleIPs()
	state.status = status{
		State:              "ready",
		Phase:              "relay",
		BaseURL:            "http://" + listener.Addr().String(),
		Hostname:           hostname,
		TailnetIPv4:        addrString(ip4),
		TailnetIPv6:        addrString(ip6),
		RemoteHost:         remoteHost,
		RemotePort:         remotePort,
		Auth:               auth{Mode: "interactive", InteractiveLogin: true},
		ControlPlaneOnline: true,
		TailnetOnline:      true,
	}
	return state.status
}

func logStatus(source string, result *ipnstate.Status, err error) {
	if err != nil {
		logMessage("%s: status error: %v", source, err)
		return
	}
	logMessage("%s: backend=%s tailnetIPs=%d", source, result.BackendState, len(result.TailscaleIPs))
}

func logMessage(format string, values ...any) {
	message := C.CString("opencode-tsnet " + fmt.Sprintf(format, values...))
	defer C.free(unsafe.Pointer(message))
	C.logToAndroid(message)
}

func serve(current *instance, remoteHost string, remotePort int) {
	defer close(current.done)
	for {
		local, err := current.listener.Accept()
		if err != nil {
			logMessage("relay: accept error: %v", err)
			return
		}
		logMessage("relay: accepted local connection")
		go proxy(current.server, local, net.JoinHostPort(remoteHost, stringPort(remotePort)))
	}
}

func proxy(server *tsnet.Server, local net.Conn, remote string) {
	defer local.Close()
	logMessage("relay: dialing %s", remote)
	ctx, cancel := context.WithTimeout(context.Background(), startupTimeout)
	remoteConn, err := server.Dial(ctx, "tcp", remote)
	cancel()
	if err != nil {
		logMessage("relay: dial failed remote=%s error=%s", remote, sanitizeError(err.Error()))
		state.Lock()
		if state.instance != nil && state.instance.server == server {
			state.status.State = "error"
			state.status.Phase = "relay"
			state.status.DiagnosticCode = dialDiagnosticCode(err)
			state.status.DiagnosticMessage = dialDiagnosticMessage(err)
			state.status.Error = sanitizeError(err.Error())
		}
		state.Unlock()
		return
	}
	logMessage("relay: dial connected %s", remote)
	defer remoteConn.Close()

	done := make(chan struct{})
	go func() {
		_, _ = io.Copy(remoteConn, local)
		_ = remoteConn.Close()
		close(done)
	}()
	_, _ = io.Copy(local, remoteConn)
	_ = local.Close()
	<-done
}

func dialDiagnosticCode(err error) string {
	if errors.Is(err, context.DeadlineExceeded) || strings.Contains(strings.ToLower(err.Error()), "timeout") {
		return "relay_dial_timeout"
	}
	if strings.Contains(strings.ToLower(err.Error()), "no such host") || strings.Contains(strings.ToLower(err.Error()), "name resolution") {
		return "peer_dns_resolution_failed"
	}
	return "relay_dial_failed"
}

func dialDiagnosticMessage(err error) string {
	switch dialDiagnosticCode(err) {
	case "relay_dial_timeout":
		return "Tailscale relay timed out while reaching the OpenCode server"
	case "peer_dns_resolution_failed":
		return "Tailscale could not resolve the OpenCode peer name"
	default:
		return "Tailscale relay could not reach the OpenCode server"
	}
}

func stopLocked() {
	current := state.instance
	if current != nil {
		logMessage("stop: state=%s listener=%t", state.status.State, current.listener != nil)
		if current.cancel != nil {
			current.cancel()
		}
		if current.listener != nil {
			_ = current.listener.Close()
			<-current.done
		}
		_ = current.server.Close()
		state.instance = nil
	}
	state.status = status{State: "stopped"}
}

func setErrorLocked(err error, secret ...string) status {
	return setDiagnosticErrorLocked("native_error", "Tailscale native error", err, secret...)
}

func setDiagnosticErrorLocked(code, diagnostic string, err error, secret ...string) status {
	message := err.Error()
	for _, value := range secret {
		message = strings.ReplaceAll(message, value, "[redacted]")
	}
	state.status = status{State: "error", DiagnosticCode: code, DiagnosticMessage: diagnostic, Error: sanitizeError(message)}
	return state.status
}

func resultJSON(result status) *C.char {
	encoded, err := json.Marshal(result)
	if err != nil {
		return C.CString(`{"state":"error","error":"Unable to encode native status"}`)
	}
	return C.CString(string(encoded))
}

func addrString(addr netip.Addr) string {
	if !addr.IsValid() {
		return ""
	}
	return addr.String()
}

func stringPort(port int) string {
	return strconv.Itoa(port)
}

func sanitizeError(message string) string {
	return strings.ReplaceAll(message, "\n", " ")
}

func main() {}
