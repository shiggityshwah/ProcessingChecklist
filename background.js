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

// Map of tracking window ports
const trackingPorts = new Map(); // portId -> {windowId, port}

let portIdCounter = 0;
let trackingPortIdCounter = 0;

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
                if (port && popoutPorts.has(portId)) {
                    port.postMessage({ action: 'ping' });
                } else {
                    // Port no longer exists, clean up
                    clearInterval(pingInterval);
                    pingTimers.delete(portId);
                }
            } catch (e) {
                console.warn(`[ProcessingChecklist-Background] Ping failed for ${portId}, cleaning up:`, e);
                clearInterval(pingInterval);
                pingTimers.delete(portId);
                popoutPorts.delete(portId);
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

            // Remove port from tracking
            popoutPorts.delete(portId);

            console.log(`[ProcessingChecklist-Background] Popout port ${portId} disconnected and cleaned up`);
        });
    } else if (port.name === "tracking") {
        const trackingPortId = `tracking-${trackingPortIdCounter++}`;

        // Set up keep-alive ping for tracking window
        const pingInterval = setInterval(() => {
            try {
                if (port && trackingPorts.has(trackingPortId)) {
                    port.postMessage({ action: 'ping' });
                } else {
                    // Port no longer exists, clean up
                    clearInterval(pingInterval);
                    pingTimers.delete(trackingPortId);
                }
            } catch (e) {
                console.warn(`[ProcessingChecklist-Background] Tracking ping failed for ${trackingPortId}, cleaning up:`, e);
                clearInterval(pingInterval);
                pingTimers.delete(trackingPortId);
                trackingPorts.delete(trackingPortId);
            }
        }, PING_INTERVAL);
        pingTimers.set(trackingPortId, pingInterval);

        port.onMessage.addListener((message) => {
            // Respond to pong messages (keep-alive)
            if (message.action === 'pong') {
                return;
            }

            // Handle tracking-specific messages
            if (message.action === 'open-form') {
                ext.tabs.create({ url: message.url });
            } else if (message.action === 'start-review') {
                // Open form in new tab and send review mode message
                ext.tabs.create({ url: message.url }, (tab) => {
                    setTimeout(() => {
                        const contentPort = contentPorts.get(tab.id);
                        if (contentPort) {
                            contentPort.postMessage({
                                action: 'start-review',
                                urlId: message.urlId
                            });
                        }
                    }, 1000);
                });
            }
        });

        port.onDisconnect.addListener(() => {
            // Clean up keep-alive timer
            const pingInterval = pingTimers.get(trackingPortId);
            if (pingInterval) {
                clearInterval(pingInterval);
                pingTimers.delete(trackingPortId);
            }
            trackingPorts.delete(trackingPortId);
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
            } else if (message.action === 'openTracking') {
                // Open tracking window
                ext.windows.create({
                    url: ext.runtime.getURL('tracking.html'),
                    type: 'popup',
                    width: 450,
                    height: 800,
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

// Handle runtime messages (for attendance page parsing)
ext.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'parseAttendancePage') {
        parseAttendancePage(request.url).then((result) => {
            sendResponse(result);
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true; // Keep channel open for async response
    }
});

/**
 * Parse attendance page to extract time entries
 */
async function parseAttendancePage(url) {
    try {
        // First, try to find an existing tab with the attendance page
        const allTabs = await ext.tabs.query({});

        // Look for tabs that match the attendance URL pattern
        let matchingTab = null;

        if (url) {
            // If URL is provided, look for exact or partial match
            const urlPattern = url.toLowerCase();
            matchingTab = allTabs.find(tab =>
                tab.url && tab.url.toLowerCase().includes(urlPattern)
            );
        }

        // If no URL provided or no exact match, look for any tab with summary-table element
        if (!matchingTab) {
            // Try to find a tab that contains the attendance table by URL pattern
            // Common patterns: attendance, timesheet, etc.
            matchingTab = allTabs.find(tab =>
                tab.url && (
                    tab.url.toLowerCase().includes('attendance') ||
                    tab.url.toLowerCase().includes('timesheet')
                )
            );
        }

        let tabToUse = matchingTab;

        // If no matching tab found, return error
        if (!tabToUse) {
            return {
                success: false,
                error: 'No attendance page found. Please open https://rapid.slacal.com/Operations/AttendanceSheet/Details in a Firefox tab first, then try again.'
            };
        }

        console.log('[ProcessingChecklist] Found existing attendance tab:', tabToUse.id);

        // Execute script to parse the table
        const results = await ext.tabs.executeScript(tabToUse.id, {
            code: `
                (function() {
                    try {
                        const table = document.getElementById('summary-table');
                        if (!table) {
                            return { error: 'Attendance table not found on page. Make sure you have the correct page open.' };
                        }

                        const tbody = table.querySelector('tbody');
                        if (!tbody) {
                            return { error: 'Table body not found' };
                        }

                        const rows = Array.from(tbody.querySelectorAll('tr'));
                        const timeEntries = {};

                        rows.forEach(row => {
                            const cells = row.querySelectorAll('td');
                            if (cells.length < 8) return; // Skip invalid rows

                            // Extract data from cells
                            // Based on attendance.html structure:
                            // 0: (empty/checkbox), 1: Date, 2: Start Time, 3: End Time,
                            // 4: Lunch, 5: Total Time, 6: Non-Prod, 7: Prod Time

                            const dateCell = cells[1]?.textContent?.trim();
                            const totalTimeCell = cells[5]?.textContent?.trim();
                            const lunchCell = cells[4]?.textContent?.trim();
                            const nonProdCell = cells[6]?.textContent?.trim();
                            const prodTimeCell = cells[7]?.textContent?.trim();

                            if (!dateCell) return;

                            // Parse date (format: M/D/YYYY or MM/DD/YYYY)
                            const dateParts = dateCell.split('/');
                            if (dateParts.length !== 3) return;

                            const month = dateParts[0].padStart(2, '0');
                            const day = dateParts[1].padStart(2, '0');
                            const year = dateParts[2];
                            const dateStr = year + '-' + month + '-' + day;

                            // Parse hours (should be in format like "7.50" or "7.5")
                            const totalHours = parseFloat(totalTimeCell) || 0;
                            const lunch = parseFloat(lunchCell) || 0;
                            const nonProd = parseFloat(nonProdCell) || 0;
                            const prodHours = parseFloat(prodTimeCell) || 0;

                            timeEntries[dateStr] = {
                                totalHours: totalHours,
                                lunch: lunch,
                                nonProd: nonProd,
                                prodHours: prodHours
                            };
                        });

                        return { success: true, timeEntries: timeEntries };
                    } catch (error) {
                        return { error: 'Failed to parse table: ' + error.message };
                    }
                })();
            `
        });

        // Return the parsed data
        const result = results && results[0];
        if (result?.error) {
            return { success: false, error: result.error };
        }

        if (result?.success && result?.timeEntries) {
            return { success: true, timeEntries: result.timeEntries };
        }

        return { success: false, error: 'Unknown parsing error' };

    } catch (error) {
        return { success: false, error: error.message };
    }
}
