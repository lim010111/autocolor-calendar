var AutoColorTriggers = (function () {
  function isManagedHandler_(handlerName) {
    return handlerName === ACFC_CONFIG.HANDLERS.CALENDAR || handlerName === ACFC_CONFIG.HANDLERS.PERIODIC;
  }

  function applyPeriodicSchedule_(builder, periodicSyncMinutes) {
    switch (periodicSyncMinutes) {
      case 5:
        builder.everyMinutes(5);
        break;
      case 10:
        builder.everyMinutes(10);
        break;
      case 15:
        builder.everyMinutes(15);
        break;
      case 30:
        builder.everyMinutes(30);
        break;
      default:
        throw new Error('Unsupported periodicSyncMinutes: ' + periodicSyncMinutes + '. Use one of ' + ACFC_CONFIG.SUPPORTED_PERIODIC_MINUTES.join(', ') + '.');
    }
  }

  function clearManagedTriggers() {
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (isManagedHandler_(trigger.getHandlerFunction())) {
        ScriptApp.deleteTrigger(trigger);
      }
    });
  }

  function installManagedTriggers() {
    var settings = AutoColorStorage.getSettings();

    clearManagedTriggers();

    settings.calendarIds.forEach(function (calendarId) {
      ScriptApp.newTrigger(ACFC_CONFIG.HANDLERS.CALENDAR)
        .forUserCalendar(calendarId)
        .onEventUpdated()
        .create();
    });

    var periodicTriggerBuilder = ScriptApp.newTrigger(ACFC_CONFIG.HANDLERS.PERIODIC).timeBased();
    applyPeriodicSchedule_(periodicTriggerBuilder, settings.periodicSyncMinutes);
    periodicTriggerBuilder.create();

    return listManagedTriggers();
  }

  function listManagedTriggers() {
    return ScriptApp.getProjectTriggers()
      .filter(function (trigger) {
        return isManagedHandler_(trigger.getHandlerFunction());
      })
      .map(function (trigger) {
        var triggerSourceId = '';

        try {
          triggerSourceId = trigger.getTriggerSourceId();
        } catch (error) {
          triggerSourceId = '';
        }

        return {
          handler: trigger.getHandlerFunction(),
          eventType: String(trigger.getEventType()),
          triggerSource: String(trigger.getTriggerSource()),
          triggerSourceId: triggerSourceId
        };
      });
  }

  return {
    clearManagedTriggers: clearManagedTriggers,
    installManagedTriggers: installManagedTriggers,
    listManagedTriggers: listManagedTriggers
  };
})();

function onCalendarChange(event) {
  var calendarId = event && event.calendarId ? String(event.calendarId) : '';
  return AutoColorSync.runForCalendar(calendarId, 'calendar-trigger');
}

function runPeriodicSync() {
  return AutoColorSync.runForConfiguredCalendars('time-trigger');
}
