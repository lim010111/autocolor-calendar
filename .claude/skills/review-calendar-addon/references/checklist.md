# Google Calendar Add-on Validation Checklist

Use this checklist strictly when reviewing Add-on code.

## 1. Manifest (`appsscript.json`) Validation
- [ ] Must request `enabledAdvancedServices` for `calendar` if Calendar API is used directly.
- [ ] Must include `addOns.common.homepageTrigger` to handle the default (no-event) state.
- [ ] Must define `addOns.calendar` configuration if event-specific features are used.
- [ ] Must specify `currentEventAccess` (`READ` or `READ_WRITE`) if `eventOpenTrigger` or `eventUpdateTrigger` is used.
- [ ] The functions specified in `runFunction` for all triggers must exist in the codebase.

## 2. API Compliance (`CardService` Strict Rules)
- [ ] **Return Types:** Trigger functions (e.g., `onHomepage`, `onEventOpen`) MUST return a single `Card` object, an array of `Card` objects, or a `ActionResponse` object. They cannot return plain strings or HTML.
- [ ] **Card Building:** Cards must be constructed using `CardService.newCardBuilder()`, built using `.build()`, and contain at least one `CardSection`.
- [ ] **Widget Nesting:** Widgets like `TextInput`, `SelectionInput`, `TextButton`, `DecoratedText` must be added to a `CardSection`, not directly to the `CardBuilder`.
- [ ] **Actions:** Button clicks or widget changes must be handled via `CardService.newAction().setFunctionName('functionName')`. The target function must accept an event object (`e`) and return an `ActionResponse` (e.g., `CardService.newActionResponseBuilder().setNavigation(...).build()`).
- [ ] **Notifications:** User feedback should use `CardService.newNotification().setText(...)` returned within an `ActionResponse`.

## 3. UI/UX Guidelines
- [ ] **No Horizontal Assumptions:** UI elements must be stacked vertically.
- [ ] **State Handling:** The code must appropriately handle the three states: 
  - Homepage (Dashboard/Global settings)
  - Event Open (Contextual event details)
  - Event Update (Form for modifying event)
- [ ] **Context Utilization:** If viewing an event (`onEventOpen`), the code should extract event context (e.g., `e.calendar.id`) and display relevant details immediately without user input.
- [ ] **Scannability:** Prefer `DecoratedText` for displaying key-value data instead of long paragraphs.
- [ ] **Actions in Footer:** Primary actions (like Save or Submit) should be placed in a `FixedFooter` to remain visible.
- [ ] **Navigation:** Back/exit paths must be provided using `CardService.newNavigation().popCard()`.
- [ ] **Empty States:** The UI must gracefully handle empty data or missing context (e.g., displaying a "No data found" card instead of crashing).