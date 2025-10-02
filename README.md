# ProcessingChecklist Firefox Extension

A Firefox extension that helps you track progress when filling out long, complex forms. It provides confirmation checkboxes next to form fields, an on-page UI showing the current field group, and a detachable popout window for tracking progress.

## Features

- **Confirmation checkboxes** next to each form field group
- **Floating on-page UI** showing current field details with inline editing
- **Detachable popout window** for multi-monitor workflows
- **Tab-isolated state** - each tab maintains independent progress
- **Persistent progress** - survives page refreshes
- **External JSON configuration** - easy to customize for different forms
- **Visual feedback** - green (confirmed), yellow (skipped) highlighting

## How to Install

1.  Open Firefox and navigate to `about:debugging`.
2.  Click on "This Firefox" in the sidebar.
3.  Click the "Load Temporary Add-on..." button.
4.  Navigate to the `ProcessingChecklist` directory and select the `manifest.json` file.

The extension is now installed and will remain active until you close Firefox.

## How to Use

### Basic Usage

1. **Navigate to your form page** (must match URL pattern in configuration)
2. **Click the extension icon** in the toolbar to open the menu
3. **Use the controls:**
   - **Toggle On-Page UI**: Show/hide the floating UI panel
   - **Open Checklist**: Opens a detachable popout window
   - **Reset**: Clears progress for the current tab
   - **Show UI by default**: Controls whether UI appears automatically on new tabs

### On-Page Features

- **Checkboxes**: Appear next to each field group - check to mark as processed
- **Floating UI Panel**: Top-right corner shows current field with inline editing
- **Visual Feedback**: Field containers turn green when confirmed, yellow when skipped
- **Buttons**:
  - **✓ (Confirm)**: Mark current field group as complete and move to next
  - **Skip**: Mark current field as skipped, return to it later

### Popout Window

- Opens a separate window that can be moved to another monitor
- Shows the same field information as the on-page UI
- Syncs automatically with the main page
- Displays policy/tracking number in top-right corner
- Closes automatically when the associated tab closes

## Configuration

The extension uses an external JSON configuration file (`checklist-config.json`) to define the form workflow. This makes it easy to adapt the extension to different forms without modifying code.

### Customizing for Your Form

1. **Open `checklist-config.json`** in a text editor
2. **Edit the metadata section:**
   ```json
   {
     "metadata": {
       "form_name": "Your Form Name",
       "url_pattern": "yourform.html|production.com/form",
       "config_version": "1.0"
     }
   }
   ```

3. **Configure the policy/tracking number field:**
   ```json
   {
     "policy_number": {
       "selector": "#yourPolicyField",
       "label": "Policy Number"
     }
   }
   ```

4. **Define your checklist items:**
   ```json
   {
     "checklist": [
       {
         "name": "Customer Name",
         "type": "group",
         "fields": [
           {
             "name": "First Name",
             "selector": "#firstName",
             "type": "text"
           },
           {
             "name": "Last Name",
             "selector": "#lastName",
             "type": "text"
           }
         ]
       }
     ]
   }
   ```

### Finding CSS Selectors

To add fields to your checklist:

1. Open your form in Firefox
2. Right-click the field → "Inspect Element"
3. In the Inspector, right-click the highlighted element
4. Choose "Copy" → "CSS Selector"
5. Paste into your YAML configuration

**Test selectors in the browser console:**
```javascript
document.querySelector("#yourSelector")  // Should return the element
```

### Field Types

- **text**: Text input fields
- **checkbox**: Checkbox inputs
- **select**: Dropdown menus
- **radio**: Radio buttons
- **virtual**: Buttons or clickable elements
- **labelWithDivText**: Special type for labels with adjacent text

### Adjusting Checkbox Placement

Use `container_selector` and `container_levels_up` to control where confirmation checkboxes appear:

```json
{
  "name": "Address Section",
  "type": "group",
  "container_selector": "#address1",
  "container_levels_up": 2,
  "fields": [

  ]
}
```

**Note**: `container_levels_up` values: 0=element, 1=parent, 2=grandparent, etc.

### Configuration Validation

The extension validates your configuration on load. If there are errors:

- A **red error box** appears on the form page
- **Detailed error messages** are logged to the browser console (F12)
- The extension won't run until the configuration is fixed

Common errors:
- **JSON syntax errors**: Missing commas, extra commas, unmatched brackets
- **Missing required fields**: `name`, `type`, `selector`
- **Empty `fields` array**: Group types need at least one field
- **Invalid type values**: Must be "group", "virtual", or "custom"
- **Single quotes**: JSON requires double quotes for strings

**Tip**: Validate your JSON at https://jsonlint.com before saving

## Architecture

The extension uses a **tab-aware port-based messaging system** with these components:

- **background.js**: Message relay hub that routes messages between tabs and popouts
- **content.js**: Main logic that runs on form pages, loads configuration, injects UI
- **config-loader-simple.js**: Fast JSON configuration loader
- **menu.js**: Browser action popup for controls
- **popout.js**: Detachable window UI

Each tab maintains isolated state using tab-specific storage keys, preventing interference between multiple form instances.

## Troubleshooting

### Extension Not Working

1. Check that your page URL matches the pattern in `metadata.url_pattern`
2. Open browser console (F12) and look for error messages
3. Verify the extension is loaded at `about:debugging`
4. Try reloading the extension and refreshing the page

### Configuration Errors

1. Open browser console (F12) to see detailed error messages
2. Check JSON syntax at https://jsonlint.com
3. Verify all required fields are present
4. Test CSS selectors in the console
5. Ensure double quotes (not single quotes) are used
6. Check for missing or extra commas

### Checkboxes in Wrong Location

1. Adjust the `container_levels_up` value
2. Verify `container_selector` points to an element inside the desired container
3. Use Inspector to visualize the DOM hierarchy

### Fields Not Found

1. Check that selectors are correct
2. Verify elements exist when the page loads
3. For dynamic content, you may need to wait for AJAX to complete

## Development

For detailed development documentation, see **CLAUDE.md** which includes:
- Complete architecture overview
- Communication flow details
- Configuration system design
- Maintenance and customization guide
- Common patterns and examples

## License

This extension is provided as-is for internal use.
