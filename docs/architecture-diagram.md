flowchart TD
%% Custom Styles
classDef sync fill:#f3f4f6,stroke:#d1d5db,stroke-width:1px,color:#374151;
classDef db fill:#dcfce7,stroke:#86efac,stroke-width:1px,color:#166534;
classDef llm fill:#fee2e2,stroke:#fca5a5,stroke-width:1px,color:#991b1b;
classDef action fill:#ede9fe,stroke:#c4b5fd,stroke-width:2px,color:#5b21b6;
classDef cloud fill:#eef2ff,stroke:#c7d2fe,stroke-width:2px,color:#4338ca;

    %% 1. Backend Core
    Cloud[Cloud Backend<br>Workers/Supabase]:::cloud --> WakeUp

    %% 2. Sync Flow & Idempotency
    subgraph SyncFlow [🔄 Reliable Sync Flow (Backend)]
        direction TB
        WakeUp([1. Wake Up<br>Webhook / Cron]):::sync --> APICall[2. Call API<br>w/ nextSyncToken]:::sync
        APICall --> FetchEvents[3. Fetch Changed Events]:::sync
        FetchEvents --> Idempotency{Is self-updated<br>by AutoColor?}
        Idempotency -- "Yes (Infinite Loop Prevention)" --> Skip[Skip Event]:::sync
        Idempotency -- "No" --> Rule
    end

    %% 3. Hybrid AI Engine (2-stage: Rule → LLM).
    subgraph AIEngine [🧠 4. Hybrid AI Engine (Rule → LLM)]
        direction TB
        Rule[Step 1. DB Rules<br>Keyword Substring Match]:::db --> RuleCheck{Matched?}
        RuleCheck -- "Yes (Fast, Free)" --> FinalColor([Color Determined])

        RuleCheck -- "No" --> Redact[PII Redaction<br>Masking User Data]
        Redact --> LLM[Step 2. LLM Fallback<br>Context Inference]:::llm
        LLM --> FinalColor
    end

    %% 4. Final Updates
    FinalColor --> UpdateEvent[5. Update Event Colors]:::action
    UpdateEvent --> SaveToken[6. Save New nextSyncToken<br>Source of Truth]:::sync
    Skip --> SaveToken
