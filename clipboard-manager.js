(function() {
    "use strict";

    const ext = (typeof browser !== 'undefined') ? browser : chrome;
    const STORAGE_KEY = 'clipboardHistory';
    const PINNED_KEY = 'clipboardPinned';
    const MAX_HISTORY = 10;

    // State
    let historyItems = [];
    let pinnedItems = [];
    let ignoreNextStorageChange = false;

    // Initialize
    function init() {
        loadState().then(() => {
            render();
            attachEventListeners();
        });
    }

    // Load state from storage
    function loadState() {
        return new Promise((resolve) => {
            ext.storage.local.get([STORAGE_KEY, PINNED_KEY], (result) => {
                historyItems = result[STORAGE_KEY] || [];
                pinnedItems = result[PINNED_KEY] || [];
                resolve();
            });
        });
    }

    // Save state to storage
    function saveState() {
        ext.storage.local.set({
            [STORAGE_KEY]: historyItems,
            [PINNED_KEY]: pinnedItems
        });
    }

    // Generate unique ID
    function generateId() {
        return Date.now() + Math.random().toString(36).substr(2, 9);
    }

    // Attach event listeners
    function attachEventListeners() {
        const addBtn = document.getElementById('add-custom-btn');
        const customInput = document.getElementById('custom-text-input');

        addBtn.addEventListener('click', handleAddCustom);
        customInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleAddCustom();
            }
        });

        // Listen for storage changes from background script
        ext.storage.onChanged.addListener((changes, area) => {
            if (area === 'local') {
                if (ignoreNextStorageChange) {
                    ignoreNextStorageChange = false;
                    return;
                }

                if (changes[STORAGE_KEY]) {
                    historyItems = changes[STORAGE_KEY].newValue || [];
                    renderHistory();
                }
                if (changes[PINNED_KEY]) {
                    pinnedItems = changes[PINNED_KEY].newValue || [];
                    renderPinned();
                }
            }
        });
    }

    // Handle add custom text
    function handleAddCustom() {
        const input = document.getElementById('custom-text-input');
        const text = input.value.trim();

        if (!text) return;

        // Create new custom item (pinned by default)
        const newItem = {
            id: generateId(),
            text: text,
            timestamp: Date.now(),
            isCustom: true,
            isPinned: true
        };

        // Add to top of pinned list
        pinnedItems.unshift(newItem);
        saveState();
        renderPinned();

        // Clear input
        input.value = '';
    }

    // Handle pin/unpin
    function handleTogglePin(id, isPinned) {
        if (isPinned) {
            // This shouldn't happen anymore since we removed unpin button from pinned items
            // But kept for safety - just delete the pinned item
            handleDelete(id);
        } else {
            // Pin: create a copy in pinned area (don't remove from history)
            const item = historyItems.find(i => i.id === id);
            if (item) {
                // Create a new pinned copy with a new ID
                const pinnedCopy = {
                    id: generateId(),
                    text: item.text,
                    timestamp: Date.now(),
                    isCustom: false,
                    isPinned: true
                };

                // Add to top of pinned list
                pinnedItems.unshift(pinnedCopy);

                // Keep the original in history - don't remove it
            }
        }

        saveState();
        render();
    }

    // Handle delete
    function handleDelete(id) {
        pinnedItems = pinnedItems.filter(i => i.id !== id);
        saveState();
        renderPinned();
    }

    // Handle item click (copy to clipboard)
    async function handleItemClick(text, element) {
        try {
            // Copy to clipboard
            await navigator.clipboard.writeText(text);

            // Set flag to ignore the next storage change (to prevent re-render interrupting animation)
            ignoreNextStorageChange = true;

            // Also send to background to add to history (in case it's not already there)
            ext.runtime.sendMessage({
                action: 'addToClipboardHistory',
                text: text
            }).catch(err => {
                console.log('Note: Could not add to history (might already be pinned):', err);
                ignoreNextStorageChange = false; // Reset if it failed
            });

            // Visual feedback
            element.classList.add('copied');

            // Show "Copied!" feedback
            const feedback = document.createElement('div');
            feedback.className = 'copied-feedback';
            feedback.textContent = 'Copied!';
            element.appendChild(feedback);

            setTimeout(() => {
                element.classList.remove('copied');
                feedback.remove();
            }, 1000);
        } catch (err) {
            console.error('Failed to copy text:', err);
        }
    }

    // Render both lists
    function render() {
        renderPinned();
        renderHistory();
    }

    // Render pinned items
    function renderPinned() {
        const container = document.getElementById('pinned-list');

        if (pinnedItems.length === 0) {
            container.innerHTML = '<div class="empty-message">No pinned items</div>';
            return;
        }

        container.innerHTML = pinnedItems.map(item => {
            const escapedText = escapeHtml(item.text);
            return `
                <div class="clipboard-item" data-id="${item.id}">
                    <div class="item-text" title="${escapedText}">${escapedText}</div>
                    <div class="item-controls">
                        <button class="delete-btn" data-id="${item.id}" title="Delete">×</button>
                    </div>
                </div>
            `;
        }).join('');

        // Attach event listeners
        container.querySelectorAll('.clipboard-item').forEach(el => {
            const id = el.dataset.id;
            const item = pinnedItems.find(i => i.id === id);

            // Click on entire item to copy (except buttons)
            el.addEventListener('click', (e) => {
                // Don't trigger if clicking on a button
                if (e.target.tagName === 'BUTTON') return;
                handleItemClick(item.text, el);
            });

            // Delete button
            const deleteBtn = el.querySelector('.delete-btn');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleDelete(id);
            });
        });
    }

    // Render history items
    function renderHistory() {
        const container = document.getElementById('history-list');

        if (historyItems.length === 0) {
            container.innerHTML = '<div class="empty-message">No clipboard history</div>';
            return;
        }

        container.innerHTML = historyItems.map(item => {
            const escapedText = escapeHtml(item.text);
            return `
                <div class="clipboard-item" data-id="${item.id}">
                    <div class="item-text" title="${escapedText}">${escapedText}</div>
                    <div class="item-controls">
                        <button class="pin-btn" data-id="${item.id}" data-pinned="false" title="Pin">📌</button>
                    </div>
                </div>
            `;
        }).join('');

        // Attach event listeners
        container.querySelectorAll('.clipboard-item').forEach(el => {
            const id = el.dataset.id;
            const item = historyItems.find(i => i.id === id);

            // Click on entire item to copy (except buttons)
            el.addEventListener('click', (e) => {
                // Don't trigger if clicking on a button
                if (e.target.tagName === 'BUTTON') return;
                handleItemClick(item.text, el);
            });

            // Pin button
            const pinBtn = el.querySelector('.pin-btn');
            pinBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleTogglePin(id, false);
            });
        });
    }

    // Escape HTML to prevent XSS
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Start the app
    init();
})();
