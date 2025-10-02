/**
 * background.js
 * Handles message passing between the content script and the popout window.
 * Manages tab-specific connections and popout lifecycle.
 */

const ext = (typeof browser !== 'undefined') ? browser : chrome;

// Map of tab IDs to their content script ports
const contentPorts = new Map(); // tabId -> port

// Map of popout ports to their metadata
const popoutPorts = new Map(); // portId -> {tabId, windowId, port}

let portIdCounter = 0;

// Keep-alive mechanism to prevent background script termination
const PING_INTERVAL = 25000; // 25 seconds
const pingTimers = new Map(); // portId -> intervalId

ext.runtime.onConnect.addListener((port) => {
    if (port.name === "content-script") {
        const tabId = port.sender.tab.id;
        contentPorts.set(tabId, port);

        // Send tab ID to content script
        port.postMessage({ action: 'init', tabId: tabId });

        port.onMessage.addListener((message) => {
            // Forward message to all popouts bound to this tab
            popoutPorts.forEach((popoutInfo) => {
                if (popoutInfo.tabId === tabId) {
                    popoutInfo.port.postMessage(message);
                }
            });
        });

        port.onDisconnect.addListener(() => {
            contentPorts.delete(tabId);
        });
    } else if (port.name === "popout") {
        const portId = `popout-${portIdCounter++}`;

        // Set up keep-alive ping for this popout
        const pingInterval = setInterval(() => {
            try {
                port.postMessage({ action: 'ping' });
            } catch (e) {
                clearInterval(pingInterval);
                pingTimers.delete(portId);
            }
        }, PING_INTERVAL);
        pingTimers.set(portId, pingInterval);

        port.onMessage.addListener((message) => {
            // Respond to pong messages (keep-alive)
            if (message.action === 'pong') {
                return;
            }

            if (message.action === 'popout-init') {
                // Store popout metadata
                const tabId = message.tabId;
                const windowId = message.windowId;
                popoutPorts.set(portId, { tabId, windowId, port });

                // Forward initialization to content script
                const contentPort = contentPorts.get(tabId);
                if (contentPort) {
                    contentPort.postMessage({ action: 'popout-ready' });
                }
            } else {
                // Forward message to content script
                const popoutInfo = popoutPorts.get(portId);
                if (popoutInfo) {
                    const contentPort = contentPorts.get(popoutInfo.tabId);
                    if (contentPort) {
                        contentPort.postMessage(message);
                    }
                }
            }
        });

        port.onDisconnect.addListener(() => {
            // Clean up keep-alive timer
            const pingInterval = pingTimers.get(portId);
            if (pingInterval) {
                clearInterval(pingInterval);
                pingTimers.delete(portId);
            }
            popoutPorts.delete(portId);
        });
    } else if (port.name === "menu-port") {
        port.onMessage.addListener((message) => {
            if (message.action === 'openPopout') {
                const tabId = message.tabId;
                ext.windows.create({
                    url: ext.runtime.getURL(`popout.html?tabId=${tabId}`),
                    type: 'popup',
                    width: 400,
                    height: 300,
                });
            } else if (message.action === 'toggleUI') {
                const tabId = message.tabId;
                const contentPort = contentPorts.get(tabId);
                if (contentPort) {
                    contentPort.postMessage(message);
                }
            } else if (message.tabId) {
                const contentPort = contentPorts.get(message.tabId);
                if (contentPort) {
                    contentPort.postMessage(message);
                }
            }
        });
    }
});

// Clean up popouts when their bound tab is closed
ext.tabs.onRemoved.addListener((tabId) => {
    // Close all popout windows bound to this tab
    popoutPorts.forEach((popoutInfo, portId) => {
        if (popoutInfo.tabId === tabId) {
            ext.windows.remove(popoutInfo.windowId).catch(() => {
                // Window might already be closed
            });
            popoutPorts.delete(portId);
        }
    });

    // Clean up storage for this tab
    ext.storage.local.remove([`checklistState_${tabId}`, `uiState_${tabId}`]);
});

// Clean up tracking when popout window is closed by user
ext.windows.onRemoved.addListener((windowId) => {
    popoutPorts.forEach((popoutInfo, portId) => {
        if (popoutInfo.windowId === windowId) {
            popoutPorts.delete(portId);
        }
    });
});
