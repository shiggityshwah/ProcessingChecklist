let contentPort = null;
let popoutPort = null;

browser.runtime.onConnect.addListener((port) => {
    console.log("Connection received from:", port.name);

    if (port.name === "content-script-port") {
        contentPort = port;
        console.log("Content script connected");
        port.onMessage.addListener((message) => {
            console.log("Message from content script:", message);
            if (popoutPort) {
                console.log("Forwarding message to popout");
                popoutPort.postMessage(message);
            } else {
                console.log("No popout connected to forward message to");
            }
        });
        port.onDisconnect.addListener(() => {
            contentPort = null;
            console.log("Content script disconnected.");
        });
    } else if (port.name === "popout-port") {
        popoutPort = port;
        console.log("Popout connected");
        port.onMessage.addListener((message) => {
            console.log("Message from popout:", message);
            if (contentPort) {
                console.log("Forwarding message to content script");
                contentPort.postMessage(message);
            } else {
                console.log("No content script connected to forward message to");
            }
        });
        port.onDisconnect.addListener(() => {
            popoutPort = null;
            console.log("Popout script disconnected.");
        });
    } else if (port.name === "menu-port") {
        port.onMessage.addListener((message) => {
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
    }
});