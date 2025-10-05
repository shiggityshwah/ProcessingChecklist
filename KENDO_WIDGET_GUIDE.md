# Kendo Widget Support Guide

## Overview

The ProcessingChecklist extension now supports Kendo UI widgets (dropdowns, date pickers, autocomplete, etc.) through the `kendo_widget` field type. This allows complex form widgets to be accessed from the floating UI and popout window.

---

## How It Works

### **Three-Tier Fallback Strategy**

The extension uses an intelligent fallback approach:

1. **Tier 1: Widget Detection** - Detects if Kendo UI is available and identifies widget type
2. **Tier 2: Fallback Input** - Creates a functional replacement (native date picker, searchable text input)
3. **Tier 3: Read-Only + Focus** - Shows current value with button to scroll to original widget

### **Bidirectional Sync**

Fallback inputs sync with original widgets every 500ms:
- Changes in fallback → update original widget
- Changes in original → update fallback input

---

## Configuration

### **Basic Example**

```json
{
  "name": "Policy Dates",
  "type": "group",
  "container_selector": "#transactionEffectiveDate",
  "container_levels_up": 4,
  "fields": [
    {
      "name": "Effective Date",
      "selector": "#transactionEffectiveDate",
      "type": "kendo_widget"
    },
    {
      "name": "Expiration Date",
      "selector": "#transactionExpirationDate",
      "type": "kendo_widget"
    }
  ]
}
```

### **Autocomplete/Dropdown Example**

```json
{
  "name": "Insurer Selection",
  "type": "group",
  "container_selector": "#SingleSelectedInsurerId_input",
  "container_levels_up": 3,
  "fields": [
    {
      "name": "Insurer Search",
      "selector": "#SingleSelectedInsurerId_input",
      "type": "kendo_widget"
    }
  ]
}
```

### **NAICS Code ComboBox Example**

```json
{
  "name": "NAICS Code",
  "type": "group",
  "container_selector": "#NaicsCode_input",
  "container_levels_up": 1,
  "fields": [
    {
      "name": "NAICS Code",
      "selector": "#NaicsCode_input",
      "type": "kendo_widget"
    }
  ]
}
```

---

## Widget Behavior

### **On-Page Floating UI**

**When Kendo is available:**
- Detects widget type (DatePicker, ComboBox, etc.)
- Creates fallback input (native date picker for dates, text input with search for autocomplete)
- Syncs bidirectionally with original widget
- User can type/select in fallback, changes apply to original

**When Kendo is NOT available (e.g., index.html testing):**
- Shows read-only current value
- "Edit on page" button scrolls to and highlights original widget
- No sync (widget must be edited directly on page)

### **Popout Window**

**Always uses read-only mode:**
- Shows current widget value
- "Edit on page" button focuses original widget
- Popout cannot directly access page widgets (security limitation)

---

## Supported Widget Types

### **Auto-Detected:**
- DropDownList
- ComboBox
- AutoComplete
- DatePicker
- TimePicker
- DateTimePicker
- NumericTextBox
- MaskedTextBox
- MultiSelect

### **Fallback Inputs:**
- **Date widgets** → `<input type="date">`
- **Numeric widgets** → `<input type="number">`
- **Autocomplete/Dropdowns** → `<input type="text">` with "Type to search..." placeholder

---

## Diagnostic Logging

The extension logs helpful messages to the browser console (F12):

```
[KendoWidgetUtils] Found data-role="combobox" on element
[KendoWidgetUtils] Detected ComboBox widget for field "NAICS Code"
[ProcessingChecklist] Kendo UI not available - using fallback for field "Effective Date"
[ProcessingChecklist] No Kendo widget detected - using read-only display
```

---

## Troubleshooting

### **Widget not detected**

**Problem:** Extension shows "No Kendo widget detected" even though widget exists.

**Solution:**
1. Check if widget is initialized (run `$("#selector").data()` in console)
2. Verify `selector` in config points to the correct element
3. Check for typos in selector (use Inspector → Copy Selector)

### **Sync not working**

**Problem:** Changes in fallback don't update original widget.

**Solution:**
1. Check console for errors
2. Verify selector matches actual widget element
3. Try refreshing the page
4. Check if widget is read-only on the page

### **"Edit on page" button doesn't scroll**

**Problem:** Button doesn't focus widget.

**Solution:**
1. Verify selector is correct
2. Widget might be hidden or in collapsed section
3. Check if widget exists on current page

### **Testing on index.html**

**Problem:** Widgets don't work on static index.html.

**Solution:**
- This is expected! Kendo widgets require active JavaScript
- index.html shows read-only mode with "Edit on page" button
- Test on the actual form to see full functionality

---

## Limitations

1. **Popout is read-only** - Due to browser security, popout cannot directly interact with page widgets
2. **Complex widgets** - Multi-row grids and advanced widgets show read-only + focus button
3. **Data sources** - Fallback inputs don't populate dropdown options (type-ahead still works)
4. **Custom widgets** - Non-Kendo widgets must use regular field types

---

## Future Enhancements

Potential improvements for future versions:

- [ ] Full Kendo widget cloning with data sources
- [ ] Support for Kendo Grid widgets
- [ ] Custom widget type detection
- [ ] Configurable sync interval
- [ ] Visual indicator when sync is active

---

## Example Workflow

**User filling out a form:**

1. Extension shows "Effective Date" field in floating UI
2. User types date in native date picker
3. Extension syncs value to original Kendo DatePicker every 500ms
4. User clicks "✓" to confirm field
5. Extension moves to next field
6. Original form now has correct date value

**Testing on index.html:**

1. Extension shows "Effective Date" with current value
2. User clicks "Edit on page" button
3. Browser scrolls to original widget and highlights it
4. User edits directly on page
5. User returns to floating UI to confirm field

---

## Technical Details

### **Files Modified**

- `config-loader-simple.js` - Added `kendo_widget` validation
- `kendo-widget-utils.js` - New utility file for widget detection and sync
- `content.js` - Added widget rendering logic
- `popout.js` - Added read-only widget display
- `style.css` - Added widget-specific styles
- `manifest.json` - Added kendo-widget-utils.js to content scripts

### **Key Functions**

- `KendoWidgetUtils.detectWidgetType()` - Identifies Kendo widget type
- `KendoWidgetUtils.getWidgetValue()` - Extracts current value
- `KendoWidgetUtils.setWidgetValue()` - Updates widget value
- `KendoWidgetUtils.setupFallbackSync()` - Creates bidirectional sync
- `renderKendoWidgets()` - Initializes widgets in UI

---

## Questions?

If you encounter issues not covered in this guide:

1. Check browser console (F12) for error messages
2. Verify configuration syntax using JSONLint
3. Test on actual form (not just index.html)
4. Check that widget selectors are correct using Inspector

