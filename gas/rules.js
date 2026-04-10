var AutoColorRules = (function () {
  function normalizeText_(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeStringList_(value) {
    var source = Array.isArray(value) ? value : (value ? [value] : []);
    var seen = {};
    var normalized = [];

    source.forEach(function (entry) {
      var next = normalizeText_(entry);

      if (!next || seen[next]) {
        return;
      }

      seen[next] = true;
      normalized.push(next);
    });

    return normalized;
  }

  function normalizeRule_(rule, index) {
    if (!rule || typeof rule !== 'object') {
      throw new Error('Each rule must be an object. Failed at index ' + index + '.');
    }

    var normalized = {
      id: String(rule.id || 'rule-' + (index + 1)).trim(),
      label: String(rule.label || rule.id || 'Rule ' + (index + 1)).trim(),
      colorId: String(rule.colorId || '').trim(),
      anyTerms: normalizeStringList_(rule.anyTerms || rule.terms || []),
      allTerms: normalizeStringList_(rule.allTerms || []),
      excludeTerms: normalizeStringList_(rule.excludeTerms || []),
      enabled: rule.enabled !== false
    };

    if (!normalized.id) {
      throw new Error('Rule id is required at index ' + index + '.');
    }

    if (!normalized.colorId) {
      throw new Error('Rule colorId is required for rule "' + normalized.id + '".');
    }

    if (!normalized.anyTerms.length && !normalized.allTerms.length) {
      throw new Error('Rule must include at least one anyTerms or allTerms entry for rule "' + normalized.id + '".');
    }

    return normalized;
  }

  function normalizeRules(rules) {
    var source = Array.isArray(rules) ? rules : [];

    if (!source.length) {
      throw new Error('At least one rule is required.');
    }

    return source.map(function (rule, index) {
      return normalizeRule_(rule, index);
    });
  }

  function buildSearchText(event) {
    return normalizeText_([
      event && event.summary,
      event && event.description,
      event && event.location
    ].filter(Boolean).join(' '));
  }

  function matchesRule_(haystack, rule) {
    if (!rule.enabled) {
      return false;
    }

    if (rule.excludeTerms.some(function (term) {
      return haystack.indexOf(term) !== -1;
    })) {
      return false;
    }

    if (rule.allTerms.some(function (term) {
      return haystack.indexOf(term) === -1;
    })) {
      return false;
    }

    if (rule.anyTerms.length && !rule.anyTerms.some(function (term) {
      return haystack.indexOf(term) !== -1;
    })) {
      return false;
    }

    return true;
  }

  function findMatchingRule(event, rules) {
    if (!event || event.status === 'cancelled') {
      return null;
    }

    var haystack = buildSearchText(event);

    if (!haystack) {
      return null;
    }

    for (var index = 0; index < rules.length; index += 1) {
      if (matchesRule_(haystack, rules[index])) {
        return rules[index];
      }
    }

    return null;
  }

  function cloneObject_(value) {
    var clone = {};
    Object.keys(value || {}).forEach(function (key) {
      clone[key] = value[key];
    });
    return clone;
  }

  function getPrivateProperties_(event) {
    return cloneObject_((event && event.extendedProperties && event.extendedProperties.private) || {});
  }

  function getManagedMetadata(event) {
    var privateProperties = getPrivateProperties_(event);

    return {
      managedBy: privateProperties[ACFC_CONFIG.PRIVATE_KEYS.MANAGED_BY] || '',
      ruleId: privateProperties[ACFC_CONFIG.PRIVATE_KEYS.RULE_ID] || '',
      classifierVersion: privateProperties[ACFC_CONFIG.PRIVATE_KEYS.CLASSIFIER_VERSION] || '',
      colorId: privateProperties[ACFC_CONFIG.PRIVATE_KEYS.COLOR_ID] || ''
    };
  }

  function shouldPatchEvent(event, rule, settings) {
    var metadata = getManagedMetadata(event);

    return event.colorId !== rule.colorId ||
      metadata.ruleId !== rule.id ||
      metadata.classifierVersion !== settings.classifierVersion ||
      metadata.colorId !== rule.colorId ||
      metadata.managedBy !== ACFC_CONFIG.APP_NAME;
  }

  function buildPatch(event, rule, settings) {
    var privateProperties = getPrivateProperties_(event);

    privateProperties[ACFC_CONFIG.PRIVATE_KEYS.MANAGED_BY] = ACFC_CONFIG.APP_NAME;
    privateProperties[ACFC_CONFIG.PRIVATE_KEYS.RULE_ID] = rule.id;
    privateProperties[ACFC_CONFIG.PRIVATE_KEYS.CLASSIFIER_VERSION] = settings.classifierVersion;
    privateProperties[ACFC_CONFIG.PRIVATE_KEYS.COLOR_ID] = rule.colorId;
    privateProperties[ACFC_CONFIG.PRIVATE_KEYS.UPDATED_AT] = new Date().toISOString();

    return {
      colorId: rule.colorId,
      extendedProperties: {
        private: privateProperties
      }
    };
  }

  function describeEvent(event) {
    return (event && event.summary ? event.summary : '(untitled event)') + ' [' + (event && event.id ? event.id : 'no-id') + ']';
  }

  return {
    normalizeRules: normalizeRules,
    buildSearchText: buildSearchText,
    findMatchingRule: findMatchingRule,
    getManagedMetadata: getManagedMetadata,
    shouldPatchEvent: shouldPatchEvent,
    buildPatch: buildPatch,
    describeEvent: describeEvent
  };
})();
