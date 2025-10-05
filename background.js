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
            } else if (message.action === 'changeViewMode') {
                const tabId = message.tabId;
                // Forward to content script
                const contentPort = contentPorts.get(tabId);
                if (contentPort) {
                    contentPort.postMessage(message);
                }
                // Forward to all popouts bound to this tab
                popoutPorts.forEach((popoutInfo) => {
                    if (popoutInfo.tabId === tabId) {
                        popoutInfo.port.postMessage(message);
                    }
                });
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
    ext.storage.local.remove([`checklistState_${tabId}`, `uiState_${tabId}`, `viewMode_${tabId}`]);
});

// Clean up tracking when popout window is closed by user
ext.windows.onRemoved.addListener((windowId) => {
    popoutPorts.forEach((popoutInfo, portId) => {
        if (popoutInfo.windowId === windowId) {
            popoutPorts.delete(portId);
        }
    });
});

// Refresh popout windows when their bound tab is refreshed
ext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only act when page starts loading (indicates refresh/navigation)
    if (changeInfo.status !== 'loading') {
        return;
    }

    // Find all popouts bound to this tab
    const boundPopouts = [];
    popoutPorts.forEach((popoutInfo, portId) => {
        if (popoutInfo.tabId === tabId) {
            boundPopouts.push(popoutInfo);
        }
    });

    // If no popouts are bound to this tab, nothing to do
    if (boundPopouts.length === 0) {
        return;
    }

    // Refresh each bound popout window
    boundPopouts.forEach((popoutInfo) => {
        const windowId = popoutInfo.windowId;

        // Query tabs in the popout window
        ext.tabs.query({ windowId: windowId }).then((tabs) => {
            if (tabs && tabs.length > 0) {
                // Popout windows typically have only one tab
                const popoutTabId = tabs[0].id;

                // Reload the popout tab
                ext.tabs.reload(popoutTabId).catch((error) => {
                    // Popout might have been closed manually
                    console.warn(`[ProcessingChecklist-Background] Failed to reload popout tab ${popoutTabId}:`, error);

                    // Clean up tracking for this popout since it's no longer valid
                    popoutPorts.forEach((info, portId) => {
                        if (info.windowId === windowId) {
                            popoutPorts.delete(portId);
                        }
                    });
                });
            }
        }).catch((error) => {
            // Window might have been closed
            console.warn(`[ProcessingChecklist-Background] Failed to query tabs for window ${windowId}:`, error);

            // Clean up tracking for this popout
            popoutPorts.forEach((info, portId) => {
                if (info.windowId === windowId) {
                    popoutPorts.delete(portId);
                }
            });
        });
    });
});
