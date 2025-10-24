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
    const logger = Logger.create('InsurerHistory');

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
            logger.error('Error reading history:', e);
            return [];
        }
    }

    /**
     * Save insurer history to browser.storage.local (async)
     */
    async function saveHistory(history) {
        try {
            await ext.storage.local.set({ [STORAGE_KEY]: history });
            logger.debug('History saved:', history.length, 'items');
        } catch (e) {
            logger.error('Error saving history:', e);
        }
    }

    /**
     * Add insurer to history (maintains max 10 items, newest first)
     */
    async function addToHistory(insurerData) {
        let history = await getHistory();

        // Check if this insurer already exists
        const existingIndex = history.findIndex(item => item.naicCode === insurerData.naicCode);

        if (existingIndex !== -1) {
            const existing = history[existingIndex];

            // Preserve status from existing entry if new data doesn't have a valid status
            if (!insurerData.status || insurerData.status === 'Unknown') {
                logger.debug('Preserving existing status:', existing.status);
                insurerData.status = existing.status;
            }

            // IMPORTANT: Preserve classes from existing entry if new data has no classes
            // This prevents wiping out COI data when visiting company details page
            if ((!insurerData.classes || insurerData.classes.length === 0) &&
                existing.classes && existing.classes.length > 0) {
                logger.debug('Preserving existing classes:', existing.classes);
                insurerData.classes = existing.classes;
            }

            // Remove the old entry
            history.splice(existingIndex, 1);
        }

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
     * Map class of insurance number to description
     */
    const CLASS_MAP = {
        '1': 'Life',
        '2': 'Fire',
        '3': 'Marine',
        '5': 'Surety and Bonds',
        '6': 'Disability',
        '7': 'Plate Glass',
        '8': 'Liability',
        '9': 'Workers\' Compensation',
        '10': 'Common Carrier Liability',
        '11': 'Boiler and Machinery',
        '12': 'Burglary and Crime',
        '16': 'Automobile',
        '18': 'Aircraft',
        '20': 'Miscellaneous'
    };

    /**
     * Extract classes of insurance from the COI page
     */
    function extractClasses() {
        const classes = [];

        // Look for class labels in the grid
        const classLabels = document.querySelectorAll('[id*="lblClass"]');

        logger.debug(`Found ${classLabels.length} class label elements`);

        classLabels.forEach(label => {
            const text = label.textContent.trim();
            if (text) {
                // Try to map number to description
                const description = CLASS_MAP[text] || text;
                if (!classes.includes(description)) {
                    classes.push(description);
                    logger.debug(`Extracted class: ${text} -> ${description}`);
                }
            }
        });

        logger.debug(`Total classes extracted: ${classes.length}`, classes);
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
        logger.debug('Detecting insurer data...');

        const name = extractInsurerName();
        const naicCode = extractNaicCode();
        const status = extractStatus();
        const classes = extractClasses();
        const insurerId = extractInsurerId();

        if (!name || !naicCode) {
            logger.debug('Could not extract required data (name or NAIC)');
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

        logger.debug('Detected insurer:', insurerData);
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

        // Status indicator class - use the stored status from history
        // Check if status contains "Admitted" but not "Non" (handles "Non-Admitted", "Non Admitted", etc.)
        const statusLower = (insurer.status || '').toLowerCase();
        const isAdmitted = statusLower.includes('admitted') && !statusLower.includes('non');
        const statusClass = isAdmitted ? 'admitted' : 'non-admitted';

        // Build HTML with optional classes button
        const hasClasses = insurer.classes && insurer.classes.length > 0;
        const classesButton = hasClasses ? '<span class="classes-icon" title="Show classes">📋</span>' : '';

        item.innerHTML = `
            <div class="insurer-main">
                <div class="insurer-name">
                    <span class="status-indicator ${statusClass}"></span>
                    <span class="insurer-name-text">${escapeHtml(insurer.name)}</span>
                    ${classesButton}
                </div>
                <div class="insurer-naic">NAIC: ${escapeHtml(insurer.naicCode)}</div>
            </div>
        `;

        // Add classes list if available (initially hidden)
        if (hasClasses) {
            const classesList = document.createElement('div');
            classesList.className = 'classes-list';
            classesList.innerHTML = insurer.classes.map(c => `<div class="class-item">• ${escapeHtml(c)}</div>`).join('');
            item.appendChild(classesList);

            // Toggle classes list on icon click
            const icon = item.querySelector('.classes-icon');
            icon.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent opening the insurer page
                classesList.classList.toggle('expanded');
                icon.textContent = classesList.classList.contains('expanded') ? '📂' : '📋';
            });

            logger.debug(`Added ${insurer.classes.length} classes for ${insurer.name}`);
        } else {
            logger.debug(`No classes data for ${insurer.name}`, insurer.classes);
        }

        // Click handler - navigate to insurer detail page (only on main area)
        const mainArea = item.querySelector('.insurer-main');
        mainArea.addEventListener('click', (e) => {
            // Don't open if clicking the icon
            if (!e.target.classList.contains('classes-icon')) {
                window.open(insurer.url, '_blank');
            }
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

        logger.debug('Initializing widget...');

        widgetContainer = createWidget();
        document.body.appendChild(widgetContainer);

        // Start minimized
        minimizeWidget();

        logger.debug('Widget initialized');
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
            logger.debug('Not an insurer page, skipping initialization');
            return;
        }

        logger.debug('Insurer page detected, initializing...');

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
                logger.debug('Insurer added to history');
            }

            // Initialize widget UI
            initWidget();
        }, 1000);
    }

    // Listen for storage changes to update widget across tabs
    ext.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes[STORAGE_KEY]) {
            logger.debug('History updated in another tab, refreshing widget');
            renderList();
        }
    });

    // Start initialization
    init();

    logger.debug('Script loaded');
})();
