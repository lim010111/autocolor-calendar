var ACFC_CONFIG = {
  APP_NAME: 'autocolor-for-calendar',
  APP_VERSION: 'stage1-v1',
  HANDLERS: {
    CALENDAR: 'onCalendarChange',
    PERIODIC: 'runPeriodicSync'
  },
  PROPERTY_KEYS: {
    SETTINGS: 'acfc.settings',
    RULES: 'acfc.rules',
    ONBOARDED: 'acfc.onboarded'
  },
  PROPERTY_PREFIXES: {
    SYNC_TOKEN: 'acfc.syncToken.'
  },
  PRIVATE_KEYS: {
    MANAGED_BY: 'acfcManagedBy',
    RULE_ID: 'acfcRuleId',
    CLASSIFIER_VERSION: 'acfcClassifierVersion',
    COLOR_ID: 'acfcColorId',
    UPDATED_AT: 'acfcUpdatedAt'
  },
  LOCK_TIMEOUT_MS: 5000,
  DEFAULT_SYNC_PAGE_SIZE: 250,
  SUPPORTED_PERIODIC_MINUTES: [5, 10, 15, 30],

  defaultSettings: function () {
    return {
      calendarIds: [CalendarApp.getDefaultCalendar().getId()],
      periodicSyncMinutes: 15,
      syncPageSize: ACFC_CONFIG.DEFAULT_SYNC_PAGE_SIZE,
      processExistingEventsOnBootstrap: false,
      dryRun: false,
      logNoMatchEvents: false,
      classifierVersion: ACFC_CONFIG.APP_VERSION
    };
  },

  defaultRules: function () {
    return [
      {
        id: 'date',
        label: '데이트 / 관계',
        colorId: '11',
        anyTerms: ['데이트', 'date', 'anniversary', '소개팅'],
        allTerms: [],
        excludeTerms: []
      },
      {
        id: 'lecture',
        label: '강의 / 수업',
        colorId: '5',
        anyTerms: ['강의', 'lecture', 'class', '수업'],
        allTerms: [],
        excludeTerms: []
      },
      {
        id: 'meal',
        label: '식사',
        colorId: '8',
        anyTerms: ['식사', 'meal', 'lunch', 'dinner', 'brunch'],
        allTerms: [],
        excludeTerms: []
      },
      {
        id: 'reading',
        label: '독서',
        colorId: '2',
        anyTerms: ['독서', 'reading', 'book club'],
        allTerms: [],
        excludeTerms: []
      },
      {
        id: 'study-dev',
        label: '개인 공부 / 개발 / 프로젝트',
        colorId: '10',
        anyTerms: ['개인 공부', 'study', '개발', 'coding', '코딩', 'project', '프로젝트'],
        allTerms: [],
        excludeTerms: []
      }
    ];
  }
};
