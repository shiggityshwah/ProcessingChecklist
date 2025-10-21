/**
 * insurer-history.js
 * Floating widget that tracks the last 10 insurers searched on RAPID insurer pages
 * Stores data in sessionStorage (clears when browser closes)
 */

(function() {
    "use strict";

    // ============================================================================
    // CONFIGURATION
    // ============================================================================

    /**
     * URL patterns that trigger the widget
     * UPDATE THIS ARRAY to match your RAPID insurer search URLs
     * Examples:
     * - 'rapid.slacal.com/search/insurer'
     * - 'CompanyDetails.aspx'
     * - 'AdmittedCompaniesDetails.aspx'
     */
    const INSURER_URL_PATTERNS = [
        'CompanyDetails.aspx',
        'AdmittedCompaniesDetails.aspx',
        'rapid.slacal.com/Insurer/Search'
    ];

    const MAX_HISTORY_ITEMS = 10;
    const STORAGE_KEY = 'insurer_history';
    const LOG_PREFIX = '[InsurerHistory]';

    // ============================================================================
    // UTILITY FUNCTIONS
    // ============================================================================

    /**
     * Check if current URL matches any of the configured patterns
     */
    function isInsurerPage() {
        const url = window.location.href;
        return INSURER_URL_PATTERNS.some(pattern => url.includes(pattern));
    }

    // Browser extension API compatibility
    const ext = (typeof browser !== 'undefined') ? browser : chrome;

    /**
     * Get insurer history from browser.storage.local (async)
     */
    async function getHistory() {
        try {
            const result = await ext.storage.local.get(STORAGE_KEY);
            return result[STORAGE_KEY] || [];
        } catch (e) {
            console.error(LOG_PREFIX, 'Error reading history:', e);
            return [];
        }
    }

    /**
     * Save insurer history to browser.storage.local (async)
     */
    async function saveHistory(history) {
        try {
            await ext.storage.local.set({ [STORAGE_KEY]: history });
            console.log(LOG_PREFIX, 'History saved:', history.length, 'items');
        } catch (e) {
            console.error(LOG_PREFIX, 'Error saving history:', e);
        }
    }

    /**
     * Add insurer to history (maintains max 10 items, newest first)
     */
    async function addToHistory(insurerData) {
        let history = await getHistory();

        // Remove if already exists (by NAIC code)
        history = history.filter(item => item.naicCode !== insurerData.naicCode);

        // Add to beginning
        history.unshift(insurerData);

        // Keep only last 10
        if (history.length > MAX_HISTORY_ITEMS) {
            history = history.slice(0, MAX_HISTORY_ITEMS);
        }

        await saveHistory(history);
        return history;
    }

    // ============================================================================
    // DATA EXTRACTION
    // ============================================================================

    /**
     * Extract insurer name from page
     */
    function extractInsurerName() {
        // Try multiple selectors
        const selectors = [
            '#ctl00_cphMain_lblCompanyNameText',
            '#ctl00_cphMain_ctrlCompanyInfoControl_lblCompanyNameText',
            'a[href*="CompanyDetails.aspx"]'
        ];

        for (const selector of selectors) {
            const elem = document.querySelector(selector);
            if (elem) {
                let text = elem.textContent.trim();
                // Remove NAIC number in parentheses if present
                text = text.replace(/\s*\(#?\d+\)\s*$/g, '');
                // Remove company ID prefix if present
                text = text.replace(/^\(\d+\)\s*/g, '');
                return text;
            }
        }

        return null;
    }

    /**
     * Extract NAIC number from page
     */
    function extractNaicCode() {
        // Try multiple selectors
        const selectors = [
            '#ctl00_cphMain_lblNAICNumberText',
            '#ctl00_cphMain_ctrlCompanyInfoControl_lblNAICNumberText'
        ];

        for (const selector of selectors) {
            const elem = document.querySelector(selector);
            if (elem) {
                return elem.textContent.trim();
            }
        }

        // Try to extract from company name link (format: "NAME (#12345)")
        const nameLink = document.querySelector('a[href*="CompanyDetails.aspx"]');
        if (nameLink) {
            const match = nameLink.textContent.match(/#(\d+)/);
            if (match) {
                return match[1];
            }
        }

        return null;
    }

    /**
     * Extract insurer status (Admitted, Non-Admitted, etc.)
     */
    function extractStatus() {
        const selectors = [
            '#ctl00_cphMain_lblCompanyStatusText',
            '#ctl00_cphMain_ctrlCompanyInfoControl_lblCompanyStatusText'
        ];

        for (const selector of selectors) {
            const elem = document.querySelector(selector);
            if (elem) {
                return elem.textContent.trim();
            }
        }

        return 'Unknown';
    }

    /**
     * Extract classes of insurance from the COI page
     */
    function extractClasses() {
        const classes = [];

        // Look for class labels in the grid
        const classLabels = document.querySelectorAll('[id*="lblClass"]');

        classLabels.forEach(label => {
            const text = label.textContent.trim();
            if (text && !classes.includes(text)) {
                classes.push(text);
            }
        });

        return classes;
    }

    /**
     * Extract insurer ID from URL
     */
    function extractInsurerId() {
        const url = window.location.href;
        const match = url.match(/[?&]ID=(\d+)/i);
        return match ? match[1] : null;
    }

    /**
     * Build insurer detail URL
     */
    function buildInsurerUrl(insurerId) {
        if (!insurerId) return window.location.href;
        return `https://rapid.slacal.com/Financial/CompanySearch/Company/CompanyDetails.aspx?Id=${insurerId}`;
    }

    /**
     * Detect and extract insurer data from current page
     */
    function detectInsurerData() {
        console.log(LOG_PREFIX, 'Detecting insurer data...');

        const name = extractInsurerName();
        const naicCode = extractNaicCode();
        const status = extractStatus();
        const classes = extractClasses();
        const insurerId = extractInsurerId();

        if (!name || !naicCode) {
            console.log(LOG_PREFIX, 'Could not extract required data (name or NAIC)');
            return null;
        }

        const insurerData = {
            name: name,
            naicCode: naicCode,
            status: status,
            classes: classes,
            insurerId: insurerId,
            url: buildInsurerUrl(insurerId),
            timestamp: Date.now()
        };

        console.log(LOG_PREFIX, 'Detected insurer:', insurerData);
        return insurerData;
    }

    // ============================================================================
    // WIDGET UI
    // ============================================================================

    let widgetContainer = null;
    let isExpanded = false;

    /**
     * Create widget HTML structure
     */
    function createWidget() {
        const container = document.createElement('div');
        container.id = 'insurer-history-widget';
        container.className = 'minimized';

        // Toggle button (minimized state)
        const toggleBtn = document.createElement('div');
        toggleBtn.className = 'widget-toggle-btn';
        toggleBtn.textContent = '+';
        toggleBtn.title = 'Recent Insurers';
        toggleBtn.addEventListener('click', expandWidget);

        // Panel (expanded state)
        const panel = document.createElement('div');
        panel.className = 'widget-panel';

        // Header
        const header = document.createElement('div');
        header.className = 'widget-header';
        header.innerHTML = `
            <h3>Recent Insurers</h3>
            <button class="widget-minimize-btn" title="Minimize">−</button>
        `;

        // List container
        const listContainer = document.createElement('div');
        listContainer.className = 'insurer-list';

        panel.appendChild(header);
        panel.appendChild(listContainer);

        container.appendChild(toggleBtn);
        container.appendChild(panel);

        // Minimize button click handler
        panel.querySelector('.widget-minimize-btn').addEventListener('click', minimizeWidget);

        return container;
    }

    /**
     * Render insurer list in the widget
     */
    async function renderList() {
        if (!widgetContainer) return;

        const listContainer = widgetContainer.querySelector('.insurer-list');
        const history = await getHistory();

        if (history.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📋</div>
                    <div class="empty-state-text">No insurers searched yet</div>
                </div>
            `;
            return;
        }

        listContainer.innerHTML = '';

        history.forEach(insurer => {
            const item = createInsurerItem(insurer);
            listContainer.appendChild(item);
        });
    }

    /**
     * Create a single insurer list item
     */
    function createInsurerItem(insurer) {
        const item = document.createElement('div');
        item.className = 'insurer-item';

        // Add classes as tooltip data
        if (insurer.classes && insurer.classes.length > 0) {
            item.setAttribute('data-classes', insurer.classes.join('\n'));
        }

        // Status indicator class - use the stored status from history
        // Check if status contains "Admitted" but not "Non" (handles "Non-Admitted", "Non Admitted", etc.)
        const statusLower = (insurer.status || '').toLowerCase();
        const isAdmitted = statusLower.includes('admitted') && !statusLower.includes('non');
        const statusClass = isAdmitted ? 'admitted' : 'non-admitted';

        item.innerHTML = `
            <div class="insurer-name">
                <span class="status-indicator ${statusClass}"></span>
                <span>${escapeHtml(insurer.name)}</span>
            </div>
            <div class="insurer-naic">NAIC: ${escapeHtml(insurer.naicCode)}</div>
        `;

        // Click handler - navigate to insurer detail page
        item.addEventListener('click', () => {
            window.open(insurer.url, '_blank');
        });

        return item;
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Expand the widget
     */
    function expandWidget() {
        if (!widgetContainer) return;
        widgetContainer.className = 'expanded';
        isExpanded = true;
        renderList();
    }

    /**
     * Minimize the widget
     */
    function minimizeWidget() {
        if (!widgetContainer) return;
        widgetContainer.className = 'minimized';
        isExpanded = false;
    }

    /**
     * Initialize the widget
     */
    function initWidget() {
        if (widgetContainer) return; // Already initialized

        console.log(LOG_PREFIX, 'Initializing widget...');

        widgetContainer = createWidget();
        document.body.appendChild(widgetContainer);

        // Start minimized
        minimizeWidget();

        console.log(LOG_PREFIX, 'Widget initialized');
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /**
     * Main initialization function
     */
    function init() {
        // Check if we're on an insurer page
        if (!isInsurerPage()) {
            console.log(LOG_PREFIX, 'Not an insurer page, skipping initialization');
            return;
        }

        console.log(LOG_PREFIX, 'Insurer page detected, initializing...');

        // Wait for page to load
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
            return;
        }

        // Additional delay to ensure dynamic content is loaded
        setTimeout(async () => {
            // Extract insurer data from page
            const insurerData = detectInsurerData();

            if (insurerData) {
                // Add to history
                await addToHistory(insurerData);
                console.log(LOG_PREFIX, 'Insurer added to history');
            }

            // Initialize widget UI
            initWidget();
        }, 1000);
    }

    // Listen for storage changes to update widget across tabs
    ext.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes[STORAGE_KEY]) {
            console.log(LOG_PREFIX, 'History updated in another tab, refreshing widget');
            renderList();
        }
    });

    // Start initialization
    init();

    console.log(LOG_PREFIX, 'Script loaded');
})();
