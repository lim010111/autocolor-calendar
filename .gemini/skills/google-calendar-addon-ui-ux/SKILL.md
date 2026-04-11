---
name: google-calendar-addon-ui-ux
description: This skill governs the design and implementation of Google Calendar Add-ons using Google's CardService API. Use this skill for Calendar-specific constraints, Event lifecycle patterns, and component architecture.
---

# Google Calendar Add-on UI/UX Skill

This skill governs the design and implementation of Google Calendar Add-ons using Google's CardService API. It pairs with frontend design skills for aesthetic direction, while THIS skill dictates Calendar-specific constraints, Event lifecycle patterns, and component architecture.

## Calendar Add-on Fundamentals

Google Calendar Add-ons render inside a constrained, card-based right sidebar via `CardService` (Apps Script) or the Google Workspace Add-ons API. You do NOT write HTML/CSS — you compose UI from Google's native card primitives to ensure consistency across Workspace.

### Core Building Blocks

| Component | Use For |
| :--- | :--- |
| `CardService.newCard()` | Top-level screen/view |
| `CardSection` | Grouping related widgets within a card |
| `TextInput` / `DateTimePicker` | User data entry (e.g., setting external deadlines) |
| `SelectionInput` | Dropdowns, checkboxes, radio buttons |
| `TextButton` / `ImageButton` | Actions and CTAs (Call to Actions) |
| `DecoratedText` | Label + value rows with icons (e.g., showing linked CRM data) |
| `FixedFooter` | Sticky bottom action bar for primary actions |
| `Navigation` | Push/pop/update the card stack |

---

## Design Principles for Calendar Add-ons

### 1. Respect the Container & Context
Calendar's sidebar is ~300px wide. Design for a narrow, vertical layout. 
*   **Never assume horizontal space:** Stack elements vertically.
*   **Avoid visual clutter:** The Calendar itself is already dense with schedules. Keep your Add-on minimal and highly scannable using `DecoratedText`.

### 2. Event-Driven Lifecycle (The 3 States)
Unlike Gmail, a Calendar Add-on must handle three distinct contextual states. Design specific cards for each:
1.  **Homepage (`homepageTrigger`):** When the user opens the Add-on *without* selecting an event. Show a dashboard, upcoming tasks, or global settings.
2.  **Event Open (`eventOpenTrigger`):** When the user clicks an existing event to view it. Show contextual data related to this specific meeting (e.g., related CRM accounts, external ticket status).
3.  **Event Update (`eventUpdateTrigger`):** When the user is creating or editing an event. Provide forms to attach data or generate meeting links.

### 3. Contextual Awareness
Great Calendar Add-ons react immediately to the currently selected event data:

```javascript
function onEventOpen(e) {
  const calendarId = e.calendar.calendarId;
  const eventId = e.calendar.id;
  
  // Requires "currentEventAccess": "READ" in manifest
  const event = CalendarApp.getCalendarById(calendarId).getEventById(eventId);
  const title = event.getTitle();
  const attendees = event.getGuestList();
  
  // Personalize the card based on event context
  return buildEventDetailCard(title, attendees);
}
```
*Always read available context and surface relevant info immediately — don't make users re-enter what Calendar already knows.*

### 4. Asynchronous UX & Conferencing
`CardService` actions are synchronous and trigger server round-trips.
*   **Action Feedback:** Use `CardService.newNotification()` for lightweight success/error toasts.
*   **Conferencing Sync:** If your Add-on creates video conferencing links (e.g., Zoom, Meet alternatives), utilize the specialized `onCreateFunction` under `calendar.conferenceSolution` in the manifest, rather than standard Card interactions, to deeply integrate with Calendar's native "Add video conferencing" button.

---

## UX Patterns

### Pattern 1: Homepage Dashboard (No Event Selected)
The default view when browsing the calendar.
*   Show global metrics, upcoming external tasks, or login states.
*   Use a `FixedFooter` for a primary global action (e.g., "Sync Now", "New Issue").

### Pattern 2: Contextual Insight Card (Event Open)
Shown when viewing a specific meeting.
*   Immediately show value related to the event (e.g., "Participants from Acme Corp").
*   Use `DecoratedText` rows for at-a-glance info.
*   Keep it scannable in under 3 seconds.

```javascript
function buildEventDetailCard(title, guestCount) {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader()
      .setTitle('Meeting Insights')
      .setSubtitle(title))
    .addSection(CardService.newCardSection()
      .addWidget(CardService.newDecoratedText()
        .setTopLabel('Guests')
        .setText(`${guestCount} attendees`))
      .addWidget(CardService.newTextButton()
        .setText('Link to CRM')
        .setOnClickAction(CardService.newAction().setFunctionName('linkEvent'))))
    .build();
}
```

### Pattern 3: Form Card (Event Update/Edit)
For data entry while creating/editing an event.
*   One logical task per form.
*   Always include a Back button + Submit in `FixedFooter`.
*   Validate server-side and return distinct error cards on failure.

---

## Manifest Setup (appsscript.json)

Calendar Add-ons require specific triggers and access scopes:

```json
{
  "timeZone": "America/New_York",
  "dependencies": {
    "enabledAdvancedServices": [
      {
        "userSymbol": "Calendar",
        "serviceId": "calendar",
        "version": "v3"
      }
    ]
  },
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "addOns": {
    "common": {
      "name": "Your Calendar Add-on",
      "logoUrl": "https://yourdomain.com/logo.png",
      "layoutProperties": {
        "primaryColor": "#1A1A2E"
      },
      "homepageTrigger": {
        "runFunction": "onHomepage",
        "enabled": true
      }
    },
    "calendar": {
      "currentEventAccess": "READ_WRITE",
      "eventOpenTrigger": {
        "runFunction": "onEventOpen"
      },
      "eventUpdateTrigger": {
        "runFunction": "onEventUpdate"
      }
    }
  }
}
```

---

## Quality Checklist

Before shipping any Calendar Add-on UI, verify:
- [ ] `homepageTrigger` handles the "no event selected" state gracefully.
- [ ] `eventOpenTrigger` loads contextual data in under 2 seconds.
- [ ] Contextual data from the event (Title, Time, Guests) is utilized where relevant.
- [ ] Every button has a clear, specific label (no generic "Submit" or "OK").
- [ ] All cards have a logical back/exit path using `CardService.newNavigation()`.
- [ ] `FixedFooter` is used for the primary CTA on all actionable cards.
- [ ] Empty states are designed (e.g., "No CRM data found for these guests").
- [ ] The manifest correctly requests `currentEventAccess` (READ or READ_WRITE).

## Anti-Patterns to Avoid

*   **Ignoring the Homepage:** Showing an error or blank screen when no event is selected. Always provide a fallback dashboard or instructions via `homepageTrigger`.
*   **Wall of text:** Use `DecoratedText` rows instead of long `TextParagraph` blocks.
*   **Too many sections:** Aim for 1–3 sections per card; split into sub-cards if needed.
*   **Reinventing native features:** Do not build a custom UI for things Calendar already does well (like picking a date/time), unless it explicitly ties to external data.
