var AutoColorSync = (function () {
  function withUserLock_(callback) {
    var lock = LockService.getUserLock();

    if (!lock.tryLock(ACFC_CONFIG.LOCK_TIMEOUT_MS)) {
      Logger.log('Skipped sync because another AutoColor run is already active.');
      return {
        skipped: true,
        reason: 'lock-not-acquired'
      };
    }

    try {
      return callback();
    } finally {
      lock.releaseLock();
    }
  }

  function createSummary_(calendarId, reason, mode) {
    return {
      calendarId: calendarId,
      reason: reason,
      mode: mode,
      pages: 0,
      seen: 0,
      evaluated: 0,
      updated: 0,
      skipped: 0,
      noMatch: 0,
      cancelled: 0,
      dryRun: 0,
      storedNextSyncToken: false
    };
  }

  function buildListOptions_(settings, pageToken, syncToken) {
    var options = {
      singleEvents: true,
      showDeleted: true,
      maxResults: settings.syncPageSize
    };

    if (pageToken) {
      options.pageToken = pageToken;
    }

    if (syncToken) {
      options.syncToken = syncToken;
    }

    return options;
  }

  function logSummary_(summary) {
    Logger.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  function processEvent_(calendarId, event, settings, rules, summary) {
    summary.evaluated += 1;

    if (!event || event.status === 'cancelled') {
      summary.cancelled += 1;
      return;
    }

    var rule = AutoColorRules.findMatchingRule(event, rules);

    if (!rule) {
      summary.noMatch += 1;

      if (settings.logNoMatchEvents) {
        Logger.log('No matching rule for ' + AutoColorRules.describeEvent(event));
      }

      return;
    }

    if (!AutoColorRules.shouldPatchEvent(event, rule, settings)) {
      summary.skipped += 1;
      return;
    }

    if (settings.dryRun) {
      Logger.log('[dry-run] Would update ' + AutoColorRules.describeEvent(event) + ' to colorId ' + rule.colorId + ' via rule ' + rule.id + '.');
      summary.dryRun += 1;
      return;
    }

    Calendar.Events.patch(AutoColorRules.buildPatch(event, rule, settings), calendarId, event.id);
    summary.updated += 1;
  }

  function processEvents_(calendarId, events, settings, rules, shouldProcessEvents, summary) {
    (events || []).forEach(function (event) {
      summary.seen += 1;

      if (shouldProcessEvents) {
        processEvent_(calendarId, event, settings, rules, summary);
      }
    });
  }

  function runPagedList_(calendarId, settings, syncToken, shouldProcessEvents, reason, mode, rules) {
    var summary = createSummary_(calendarId, reason, mode);
    var pageToken = null;
    var nextSyncToken = null;

    do {
      var response = Calendar.Events.list(calendarId, buildListOptions_(settings, pageToken, syncToken));
      var items = response.items || [];

      summary.pages += 1;
      processEvents_(calendarId, items, settings, rules, shouldProcessEvents, summary);

      pageToken = response.nextPageToken || null;

      if (response.nextSyncToken) {
        nextSyncToken = response.nextSyncToken;
      }
    } while (pageToken);

    if (!nextSyncToken) {
      throw new Error('Calendar API did not return nextSyncToken for calendar ' + calendarId + '.');
    }

    AutoColorStorage.setSyncToken(calendarId, nextSyncToken);
    summary.storedNextSyncToken = true;

    return summary;
  }

  function isFullSyncRequiredError_(error) {
    var message = String(error && error.message ? error.message : error);

    return message.indexOf('Sync token is no longer valid') !== -1 ||
      message.indexOf('fullSyncRequired') !== -1 ||
      message.indexOf('410') !== -1;
  }

  function fullSyncCalendar_(calendarId, settings, rules, processExistingEvents, reason, mode) {
    var summary = runPagedList_(calendarId, settings, null, processExistingEvents, reason, mode, rules);
    return logSummary_(summary);
  }

  function incrementalSyncCalendar_(calendarId, settings, rules, reason) {
    var syncToken = AutoColorStorage.getSyncToken(calendarId);

    if (!syncToken) {
      return fullSyncCalendar_(calendarId, settings, rules, settings.processExistingEventsOnBootstrap, reason, 'full-bootstrap');
    }

    try {
      var summary = runPagedList_(calendarId, settings, syncToken, true, reason, 'incremental', rules);
      return logSummary_(summary);
    } catch (error) {
      if (!isFullSyncRequiredError_(error)) {
        throw error;
      }

      Logger.log('Sync token became invalid for ' + calendarId + '. Falling back to full resync.');
      AutoColorStorage.clearSyncToken(calendarId);
      return fullSyncCalendar_(calendarId, settings, rules, true, reason, 'full-resync');
    }
  }

  function runAcrossCalendars_(calendarIds, runner, reason) {
    return withUserLock_(function () {
      var settings = AutoColorStorage.getSettings();
      var rules = AutoColorStorage.getRules();
      var summaries = [];
      var errors = [];

      calendarIds.forEach(function (calendarId) {
        try {
          summaries.push(runner(calendarId, settings, rules, reason));
        } catch (error) {
          errors.push({
            calendarId: calendarId,
            message: error.message
          });
        }
      });

      var aggregate = {
        reason: reason,
        calendarCount: calendarIds.length,
        results: summaries,
        errors: errors
      };

      Logger.log(JSON.stringify(aggregate, null, 2));

      if (errors.length) {
        throw new Error('One or more calendar syncs failed: ' + JSON.stringify(errors));
      }

      return aggregate;
    });
  }

  function runForConfiguredCalendars(reason) {
    var settings = AutoColorStorage.getSettings();
    return runAcrossCalendars_(settings.calendarIds, function (calendarId, currentSettings, rules, currentReason) {
      return incrementalSyncCalendar_(calendarId, currentSettings, rules, currentReason);
    }, reason || 'manual');
  }

  function runForCalendar(calendarId, reason) {
    var targetCalendarId = String(calendarId || '').trim();

    if (!targetCalendarId) {
      return runForConfiguredCalendars(reason || 'calendar-trigger-fallback');
    }

    return runAcrossCalendars_([targetCalendarId], function (currentCalendarId, settings, rules, currentReason) {
      return incrementalSyncCalendar_(currentCalendarId, settings, rules, currentReason);
    }, reason || 'manual-single-calendar');
  }

  function bootstrapConfiguredCalendars(processExistingEvents, reason) {
    var settings = AutoColorStorage.getSettings();

    return runAcrossCalendars_(settings.calendarIds, function (calendarId, currentSettings, rules, currentReason) {
      return fullSyncCalendar_(calendarId, currentSettings, rules, processExistingEvents, currentReason, processExistingEvents ? 'full-bootstrap-with-processing' : 'full-bootstrap');
    }, reason || 'bootstrap');
  }

  function backfillConfiguredCalendars(reason) {
    return bootstrapConfiguredCalendars(true, reason || 'backfill');
  }

  return {
    runForConfiguredCalendars: runForConfiguredCalendars,
    runForCalendar: runForCalendar,
    bootstrapConfiguredCalendars: bootstrapConfiguredCalendars,
    backfillConfiguredCalendars: backfillConfiguredCalendars
  };
})();
