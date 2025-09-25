/**
 * background.js
 * Add small message-queueing and debug support so popout/content connection race
 * doesn't cause the popout to appear stuck on "Loading..."
 */

const DEBUG = false;

let contentPort = null;
let popoutPort = null;

// Queues used when one side is not yet connected
const queueToPopout = [];
const queueToContent = [];

function dbg(...args) {
    if (DEBUG && console && console.debug) console.debug("[ProcessingChecklist-bg]", ...args);
}

browser.runtime.onConnect.addListener((port) => {
    dbg("Connection received from:", port.name);

    if (port.name === "content-script-port") {
        contentPort = port;
        dbg("Content script connected");

        // Flush any queued messages waiting for content
        while (queueToContent.length > 0 && contentPort) {
            const queued = queueToContent.shift();
            dbg("Delivering queued message to content:", queued);
            try { contentPort.postMessage(queued); } catch (e) { dbg("Error posting queued to content:", e); }
        }

        port.onMessage.addListener((message) => {
            dbg("Message from content script:", message);
            if (popoutPort) {
                try {
                    dbg("Forwarding message to popout");
                    popoutPort.postMessage(message);
                } catch (e) {
                    dbg("Error forwarding to popout, queueing:", e);
                    queueToPopout.push(message);
                }
            } else {
                dbg("No popout connected, queueing message for popout");
                queueToPopout.push(message);
            }
        });

        port.onDisconnect.addListener(() => {
            contentPort = null;
            dbg("Content script disconnected.");
        });

    } else if (port.name === "popout-port") {
        popoutPort = port;
        dbg("Popout connected");

        // Deliver any queued messages waiting for the popout
        while (queueToPopout.length > 0 && popoutPort) {
            const queued = queueToPopout.shift();
            dbg("Delivering queued message to popout:", queued);
            try { popoutPort.postMessage(queued); } catch (e) { dbg("Error posting queued to popout:", e); }
        }

        port.onMessage.addListener((message) => {
            dbg("Message from popout:", message);
            if (contentPort) {
                try {
                    dbg("Forwarding message to content script");
                    contentPort.postMessage(message);
                } catch (e) {
                    dbg("Error forwarding to content, queueing:", e);
                    queueToContent.push(message);
                }
            } else {
                dbg("No content script connected, queueing message for content");
                queueToContent.push(message);
            }
        });

        port.onDisconnect.addListener(() => {
            popoutPort = null;
            dbg("Popout script disconnected.");
        });

    } else if (port.name === "menu-port") {
        dbg("Menu connected");
        port.onMessage.addListener((message) => {
            dbg("Message from menu:", message);
            if (message.action === 'toggleUI') {
                if (contentPort) {
                    contentPort.postMessage({ action: 'toggleUI' });
                } else {
                    console.warn("Cannot toggle UI, content script not connected.");
                }
            } else if (message.action === 'openPopout') {
                browser.windows.create({
                    url: browser.runtime.getURL('popout.html'),
                    type: 'popup',
                    width: 350,
                    height: 250,
                });
            }
        });

        port.onDisconnect.addListener(() => {
            dbg("Menu disconnected");
        });
    } else {
        dbg("Unknown port connected:", port.name);
    }
});
