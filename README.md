# ProcessingChecklist Firefox Extension

This Firefox extension helps you keep track of your progress when filling out long forms. It adds a checkbox next to each form field, remembers which fields you've checked, and tells you the next one to complete.

## How to Install

1.  Open Firefox and navigate to `about:debugging`.
2.  Click on "This Firefox" in the sidebar.
3.  Click the "Load Temporary Add-on..." button.
4.  Navigate to the `ProcessingChecklist` directory and select the `manifest.json` file.

The extension is now installed and will remain active until you close Firefox.

## How to Use

Once installed, the extension will automatically work on any web page containing a form.

*   **Checkboxes:** A checkbox will appear to the left of every input field, textarea, and select dropdown.
*   **Progress Tracking:** When you check a box, your progress is saved. If you refresh the page or come back to it later, the boxes you've checked will remain checked.
*   **Next Field Display:** A small box will appear in the bottom-right corner of the page, telling you the name or label of the next form field you need to fill out. Once all fields are checked, it will display "All fields checked!".

## How to Contribute

This is a simple extension and a great starting point for learning about browser extension development. Here are some ways you could contribute:

*   **Improve the "Next Field" display:**
    *   Make it movable or dismissible.
    *   Add an option to highlight the next field on the page.
*   **Enhance Storage:**
    *   Use `browser.storage.sync` to sync progress across devices (this would require an addon ID and API keys).
*   **Add a Popup Menu:**
    *   Create a popup from the browser toolbar that allows users to enable/disable the extension on certain sites or clear their progress for the current page.
*   **Refine Field Detection:**
    *   Improve the logic for finding form fields, especially in complex, dynamic web applications (e.g., those built with React, Angular, or Vue).

To get started, simply clone this repository, make your changes, and load the extension in Firefox as described in the "How to Install" section.
