/* Generated from the normative JSON Schemas by scripts/generate-types.mjs. DO NOT EDIT. */
export const agentManifestSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.raia.ai/devkit/v1alpha1/agent-manifest.schema.json",
  "title": "raia Agent Manifest",
  "description": "Canonical developer-facing definition of a versioned raia agent.",
  "type": "object",
  "additionalProperties": false,
  "required": ["apiVersion", "kind", "metadata", "spec"],
  "properties": {
    "apiVersion": {
      "const": "devkit.raia.ai/v1alpha1"
    },
    "kind": {
      "const": "Agent"
    },
    "metadata": {
      "$ref": "#/$defs/metadata"
    },
    "spec": {
      "$ref": "#/$defs/agentSpec"
    }
  },
  "$defs": {
    "identifier": {
      "type": "string",
      "minLength": 1,
      "maxLength": 63,
      "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"
    },
    "metadata": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name"],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "description": {
          "type": "string",
          "maxLength": 500
        },
        "workspaceId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "agentId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "labels": {
          "$ref": "#/$defs/stringMap"
        },
        "annotations": {
          "$ref": "#/$defs/stringMap"
        }
      }
    },
    "agentSpec": {
      "type": "object",
      "additionalProperties": false,
      "required": ["instructions", "model"],
      "properties": {
        "persona": {
          "$ref": "#/$defs/persona"
        },
        "instructions": {
          "$ref": "#/$defs/artifactSource"
        },
        "model": {
          "$ref": "#/$defs/modelConfig"
        },
        "skills": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/skill"
          },
          "default": []
        },
        "functions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/functionDefinition"
          },
          "default": []
        },
        "knowledge": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/knowledgePack"
          },
          "default": []
        },
        "escalation": {
          "$ref": "#/$defs/escalation"
        },
        "guardrails": {
          "$ref": "#/$defs/guardrails"
        },
        "integrations": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/integration"
          },
          "default": []
        },
        "evaluations": {
          "$ref": "#/$defs/evaluationConfig"
        },
        "deployment": {
          "$ref": "#/$defs/deploymentDefaults"
        }
      }
    },
    "persona": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "displayName": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "role": {
          "type": "string",
          "maxLength": 300
        },
        "tone": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 60
          },
          "uniqueItems": true,
          "maxItems": 12
        },
        "brandVoice": {
          "$ref": "#/$defs/artifactSource"
        }
      }
    },
    "modelConfig": {
      "type": "object",
      "additionalProperties": false,
      "required": ["modelId"],
      "properties": {
        "modelId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "temperature": {
          "type": "number",
          "minimum": 0,
          "maximum": 2
        },
        "maxOutputTokens": {
          "type": "integer",
          "minimum": 1,
          "maximum": 200000
        },
        "reasoning": {
          "type": "string",
          "enum": ["disabled", "low", "medium", "high"]
        },
        "responseFormat": {
          "type": "string",
          "enum": ["text", "json"]
        }
      }
    },
    "skill": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "source"],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "source": {
          "$ref": "#/$defs/resourceReference"
        },
        "enabled": {
          "type": "boolean",
          "default": true
        },
        "configuration": {
          "type": "object",
          "additionalProperties": true
        }
      }
    },
    "functionDefinition": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "description", "inputSchema", "handler"],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000
        },
        "inputSchema": {
          "type": "object",
          "description": "JSON Schema for function input."
        },
        "outputSchema": {
          "type": "object",
          "description": "Optional JSON Schema for function output."
        },
        "handler": {
          "$ref": "#/$defs/functionHandler"
        },
        "riskLevel": {
          "type": "string",
          "enum": ["low", "medium", "high", "critical"],
          "default": "medium"
        },
        "requiresConfirmation": {
          "type": "boolean",
          "default": false
        },
        "timeoutMs": {
          "type": "integer",
          "minimum": 100,
          "maximum": 120000,
          "default": 30000
        }
      }
    },
    "functionHandler": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type"],
      "properties": {
        "type": {
          "type": "string",
          "enum": ["integration", "webhook", "mcp", "raia-skill"]
        },
        "integrationRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "endpoint": {
          "type": "string",
          "format": "uri",
          "pattern": "^https://"
        },
        "mcpServerRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "mcpTool": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "skillRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "credential": {
          "$ref": "#/$defs/secretReference"
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "type": {
                "const": "integration"
              }
            }
          },
          "then": {
            "required": ["integrationRef"]
          }
        },
        {
          "if": {
            "properties": {
              "type": {
                "const": "webhook"
              }
            }
          },
          "then": {
            "required": ["endpoint"]
          }
        },
        {
          "if": {
            "properties": {
              "type": {
                "const": "mcp"
              }
            }
          },
          "then": {
            "required": ["mcpServerRef", "mcpTool"]
          }
        },
        {
          "if": {
            "properties": {
              "type": {
                "const": "raia-skill"
              }
            }
          },
          "then": {
            "required": ["skillRef"]
          }
        }
      ]
    },
    "knowledgePack": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "source"],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "source": {
          "$ref": "#/$defs/resourceReference"
        },
        "retrieval": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "topK": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100
            },
            "minimumScore": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "queryRewrite": {
              "type": "boolean"
            }
          }
        }
      }
    },
    "escalation": {
      "type": "object",
      "additionalProperties": false,
      "required": ["enabled"],
      "properties": {
        "enabled": {
          "type": "boolean"
        },
        "conditions": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 500
          },
          "maxItems": 50
        },
        "destinations": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "uniqueItems": true
        },
        "handoffMessage": {
          "$ref": "#/$defs/artifactSource"
        }
      }
    },
    "guardrails": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "policyPacks": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/resourceReference"
          },
          "default": []
        },
        "blockedTopics": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "uniqueItems": true
        },
        "piiHandling": {
          "type": "string",
          "enum": ["deny", "redact", "allow-by-policy"]
        },
        "promptInjectionDefense": {
          "type": "string",
          "enum": ["standard", "strict"]
        }
      }
    },
    "integration": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "source"],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "source": {
          "$ref": "#/$defs/resourceReference"
        },
        "credential": {
          "$ref": "#/$defs/secretReference"
        },
        "configuration": {
          "type": "object",
          "additionalProperties": true
        }
      }
    },
    "evaluationConfig": {
      "type": "object",
      "additionalProperties": false,
      "required": ["suites"],
      "properties": {
        "suites": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 500
          },
          "uniqueItems": true
        },
        "requiredTags": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          },
          "uniqueItems": true
        }
      }
    },
    "deploymentDefaults": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "defaultEnvironment": {
          "type": "string",
          "enum": ["development", "staging"],
          "default": "staging"
        },
        "releasePolicy": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      }
    },
    "artifactSource": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "inline": {
          "type": "string",
          "minLength": 1
        },
        "file": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "remoteRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "oneOf": [
        {
          "required": ["inline"]
        },
        {
          "required": ["file"]
        },
        {
          "required": ["remoteRef"]
        }
      ]
    },
    "resourceReference": {
      "type": "object",
      "additionalProperties": false,
      "required": ["remoteRef"],
      "properties": {
        "remoteRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "version": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "checksum": {
          "type": "string",
          "pattern": "^sha256:[a-f0-9]{64}$"
        }
      }
    },
    "secretReference": {
      "type": "object",
      "additionalProperties": false,
      "required": ["secretRef"],
      "properties": {
        "secretRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300,
          "pattern": "^(env|vault|raia-secret)://"
        }
      }
    },
    "stringMap": {
      "type": "object",
      "propertyNames": {
        "pattern": "^[A-Za-z0-9_.-]{1,100}$"
      },
      "additionalProperties": {
        "type": "string",
        "maxLength": 500
      }
    }
  }
} as const;
export const agentLockSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.raia.ai/devkit/v1alpha1/agent-lock.schema.json",
  "title": "raia Agent Lock File",
  "description": "Deterministic resolution record for a raia agent manifest.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "lockVersion",
    "manifestApiVersion",
    "manifestSha256",
    "generatedBy",
    "resolved"
  ],
  "properties": {
    "lockVersion": {
      "const": 1
    },
    "manifestApiVersion": {
      "const": "devkit.raia.ai/v1alpha1"
    },
    "manifestSha256": {
      "$ref": "#/$defs/sha256"
    },
    "generatedAt": {
      "type": "string",
      "format": "date-time",
      "description": "Informational only; excluded from deterministic content hashing."
    },
    "generatedBy": {
      "type": "object",
      "additionalProperties": false,
      "required": ["cliVersion"],
      "properties": {
        "cliVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "gitCommit": {
          "type": "string",
          "pattern": "^[a-fA-F0-9]{7,64}$"
        }
      }
    },
    "remote": {
      "type": "object",
      "additionalProperties": false,
      "required": ["workspaceId", "agentId", "baseVersionId", "etag"],
      "properties": {
        "workspaceId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "agentId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "baseVersionId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "etag": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "region": {
          "type": "string",
          "enum": ["us", "eu", "custom"]
        }
      }
    },
    "resolved": {
      "type": "object",
      "additionalProperties": false,
      "required": ["model", "skills", "functions", "knowledge", "integrations", "policyPacks", "evaluators"],
      "properties": {
        "model": {
          "$ref": "#/$defs/resolvedItem"
        },
        "skills": {
          "$ref": "#/$defs/resolvedItemArray"
        },
        "functions": {
          "$ref": "#/$defs/resolvedItemArray"
        },
        "knowledge": {
          "$ref": "#/$defs/resolvedItemArray"
        },
        "integrations": {
          "$ref": "#/$defs/resolvedItemArray"
        },
        "policyPacks": {
          "$ref": "#/$defs/resolvedItemArray"
        },
        "evaluators": {
          "$ref": "#/$defs/resolvedItemArray"
        }
      }
    }
  },
  "$defs": {
    "sha256": {
      "type": "string",
      "pattern": "^sha256:[a-f0-9]{64}$"
    },
    "resolvedItem": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "version", "checksum"],
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "remoteId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "version": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "checksum": {
          "$ref": "#/$defs/sha256"
        },
        "metadata": {
          "type": "object",
          "additionalProperties": {
            "type": ["string", "number", "boolean", "null"]
          }
        }
      }
    },
    "resolvedItemArray": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/resolvedItem"
      }
    }
  }
} as const;
export const evalSuiteSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.raia.ai/devkit/v1alpha1/eval-suite.schema.json",
  "title": "raia Agent Evaluation Suite",
  "type": "object",
  "additionalProperties": false,
  "required": ["apiVersion", "kind", "metadata", "spec"],
  "properties": {
    "apiVersion": {
      "const": "devkit.raia.ai/v1alpha1"
    },
    "kind": {
      "const": "EvaluationSuite"
    },
    "metadata": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name"],
      "properties": {
        "name": {
          "$ref": "#/$defs/identifier"
        },
        "description": {
          "type": "string",
          "maxLength": 1000
        },
        "tags": {
          "$ref": "#/$defs/stringArray"
        }
      }
    },
    "spec": {
      "type": "object",
      "additionalProperties": false,
      "required": ["cases"],
      "properties": {
        "defaults": {
          "$ref": "#/$defs/defaults"
        },
        "cases": {
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/$defs/case"
          }
        }
      }
    }
  },
  "$defs": {
    "identifier": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100,
      "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"
    },
    "stringArray": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 100
      },
      "uniqueItems": true
    },
    "defaults": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "mode": {
          "type": "string",
          "enum": ["fixture", "live"],
          "default": "fixture"
        },
        "repetitions": {
          "type": "integer",
          "minimum": 1,
          "maximum": 20,
          "default": 1
        },
        "timeoutMs": {
          "type": "integer",
          "minimum": 100,
          "maximum": 300000,
          "default": 60000
        },
        "concurrency": {
          "type": "integer",
          "minimum": 1,
          "maximum": 20,
          "default": 1
        },
        "seed": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "case": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "description", "criticality", "conversation", "assertions"],
      "properties": {
        "id": {
          "$ref": "#/$defs/identifier"
        },
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000
        },
        "criticality": {
          "type": "string",
          "enum": ["informational", "standard", "high", "blocking"]
        },
        "tags": {
          "$ref": "#/$defs/stringArray"
        },
        "persona": {
          "$ref": "#/$defs/persona"
        },
        "initialContext": {
          "type": "object",
          "additionalProperties": true
        },
        "conversation": {
          "oneOf": [
            {
              "type": "object",
              "additionalProperties": false,
              "required": ["turns"],
              "properties": {
                "turns": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "$ref": "#/$defs/turn"
                  }
                }
              }
            },
            {
              "type": "object",
              "additionalProperties": false,
              "required": ["simulator"],
              "properties": {
                "simulator": {
                  "$ref": "#/$defs/simulator"
                }
              }
            }
          ]
        },
        "toolPolicy": {
          "$ref": "#/$defs/toolPolicy"
        },
        "expectedStates": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          }
        },
        "assertions": {
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/$defs/assertion"
          }
        },
        "businessMetrics": {
          "type": "object",
          "additionalProperties": {
            "type": ["string", "number", "boolean", "null"]
          }
        }
      }
    },
    "persona": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000
        },
        "goal": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000
        },
        "behavior": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 500
          },
          "maxItems": 30
        }
      }
    },
    "turn": {
      "type": "object",
      "additionalProperties": false,
      "required": ["role", "content"],
      "properties": {
        "role": {
          "type": "string",
          "enum": ["user", "assistant", "tool"]
        },
        "content": {
          "type": "string",
          "minLength": 1
        },
        "toolName": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "fixtureRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      }
    },
    "simulator": {
      "type": "object",
      "additionalProperties": false,
      "required": ["goal", "maxTurns"],
      "properties": {
        "goal": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000
        },
        "maxTurns": {
          "type": "integer",
          "minimum": 1,
          "maximum": 30
        },
        "modelRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        }
      }
    },
    "toolPolicy": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "allowed": {
          "$ref": "#/$defs/stringArray"
        },
        "forbidden": {
          "$ref": "#/$defs/stringArray"
        }
      }
    },
    "assertion": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "type"],
      "properties": {
        "id": {
          "$ref": "#/$defs/identifier"
        },
        "type": {
          "type": "string",
          "enum": [
            "exact",
            "contains",
            "regex",
            "json-schema",
            "tool-call",
            "tool-not-called",
            "latency",
            "cost",
            "conversation-state",
            "rubric"
          ]
        },
        "target": {
          "type": "string",
          "enum": ["last-assistant-message", "conversation", "tool-trajectory", "final-state", "run"]
        },
        "expected": {},
        "schema": {
          "type": "object"
        },
        "toolName": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "maximum": {
          "type": "number"
        },
        "rubric": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "minimumScore": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "critical": {
          "type": "boolean",
          "default": false
        }
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "type": {
                "const": "json-schema"
              }
            }
          },
          "then": {
            "required": ["schema"]
          }
        },
        {
          "if": {
            "properties": {
              "type": {
                "enum": ["tool-call", "tool-not-called"]
              }
            }
          },
          "then": {
            "required": ["toolName"]
          }
        },
        {
          "if": {
            "properties": {
              "type": {
                "enum": ["latency", "cost"]
              }
            }
          },
          "then": {
            "required": ["maximum"]
          }
        },
        {
          "if": {
            "properties": {
              "type": {
                "const": "rubric"
              }
            }
          },
          "then": {
            "required": ["rubric", "minimumScore"]
          }
        }
      ]
    }
  }
} as const;
export const releasePolicySchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.raia.ai/devkit/v1alpha1/release-policy.schema.json",
  "title": "raia Agent Release Policy",
  "type": "object",
  "additionalProperties": false,
  "required": ["apiVersion", "kind", "metadata", "spec"],
  "properties": {
    "apiVersion": {
      "const": "devkit.raia.ai/v1alpha1"
    },
    "kind": {
      "const": "ReleasePolicy"
    },
    "metadata": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name"],
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100,
          "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"
        },
        "description": {
          "type": "string",
          "maxLength": 1000
        }
      }
    },
    "spec": {
      "type": "object",
      "additionalProperties": false,
      "required": ["validation", "evaluation", "approval", "environments"],
      "properties": {
        "validation": {
          "type": "object",
          "additionalProperties": false,
          "required": ["requireSchema", "requireSecretScan", "requireNoDrift"],
          "properties": {
            "requireSchema": { "type": "boolean" },
            "requireSecretScan": { "type": "boolean" },
            "requireNoDrift": { "type": "boolean" },
            "maximumRisk": {
              "type": "string",
              "enum": ["low", "medium", "high", "critical"]
            }
          }
        },
        "evaluation": {
          "type": "object",
          "additionalProperties": false,
          "required": ["requiredSuites", "blockOnCriticalFailure"],
          "properties": {
            "requiredSuites": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 500
              },
              "uniqueItems": true
            },
            "requiredTags": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 100
              },
              "uniqueItems": true
            },
            "minimumPassRate": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "blockOnCriticalFailure": {
              "type": "boolean"
            },
            "maximumRegressionCount": {
              "type": "integer",
              "minimum": 0
            }
          }
        },
        "approval": {
          "type": "object",
          "additionalProperties": false,
          "required": ["stagingApprovals"],
          "properties": {
            "stagingApprovals": {
              "type": "integer",
              "minimum": 0,
              "maximum": 20
            },
            "productionApprovals": {
              "type": "integer",
              "minimum": 1,
              "maximum": 20
            },
            "requiredRoles": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 100
              },
              "uniqueItems": true
            }
          }
        },
        "environments": {
          "type": "object",
          "additionalProperties": false,
          "required": ["claudeCodeAllowed"],
          "properties": {
            "claudeCodeAllowed": {
              "type": "array",
              "items": {
                "type": "string",
                "enum": ["development", "staging"]
              },
              "uniqueItems": true
            },
            "requireImmutableRelease": {
              "type": "boolean",
              "default": true
            }
          }
        }
      }
    }
  }
} as const;
export const workflowStateSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.raia.ai/devkit/v1alpha1/workflow-state.schema.json",
  "title": "raia Agent DevKit Workflow State",
  "description": "Local resumability record for one exact candidate. This file contains identifiers and hashes, never credentials or agent content.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "stateVersion",
    "agentId",
    "workspaceId",
    "stage",
    "candidate",
    "evidence",
    "history",
    "updatedAt"
  ],
  "properties": {
    "stateVersion": {
      "const": 1
    },
    "agentId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "workspaceId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "stage": {
      "$ref": "#/$defs/stage"
    },
    "candidate": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "baseVersionId",
        "expectedEtag",
        "manifestSha256",
        "lockSha256",
        "candidateSha256",
        "coreVersion"
      ],
      "properties": {
        "baseVersionId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "expectedEtag": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "manifestSha256": {
          "$ref": "#/$defs/sha256"
        },
        "lockSha256": {
          "$ref": "#/$defs/sha256"
        },
        "candidateSha256": {
          "$ref": "#/$defs/sha256"
        },
        "releasePolicySha256": {
          "$ref": "#/$defs/sha256"
        },
        "gitCommit": {
          "type": "string",
          "pattern": "^[a-fA-F0-9]{7,64}$"
        },
        "coreVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        }
      }
    },
    "remote": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "planId": {
          "type": "string"
        },
        "draftId": {
          "type": "string"
        },
        "evaluationRunIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true
        },
        "releaseCandidateId": {
          "type": "string"
        },
        "deploymentIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true
        }
      }
    },
    "evidence": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/evidence"
      }
    },
    "history": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/transition"
      }
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time",
      "description": "Informational only and excluded from deterministic candidate hashing."
    }
  },
  "$defs": {
    "sha256": {
      "type": "string",
      "pattern": "^sha256:[a-f0-9]{64}$"
    },
    "stage": {
      "type": "string",
      "enum": [
        "DRAFT",
        "PLANNED",
        "VALIDATED",
        "EVALUATED",
        "APPROVED",
        "REJECTED",
        "RELEASED"
      ]
    },
    "evidence": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "type", "sha256", "candidateSha256", "status", "createdAt"],
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "type": {
          "type": "string",
          "enum": ["plan", "validation", "evaluation", "approval", "release", "deployment"]
        },
        "sha256": {
          "$ref": "#/$defs/sha256"
        },
        "candidateSha256": {
          "$ref": "#/$defs/sha256"
        },
        "status": {
          "type": "string",
          "enum": ["passed", "failed", "approved", "rejected", "created", "healthy", "error"]
        },
        "path": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "remoteId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "transition": {
      "type": "object",
      "additionalProperties": false,
      "required": ["from", "to", "candidateSha256", "evidenceIds", "occurredAt"],
      "properties": {
        "from": {
          "oneOf": [
            {
              "$ref": "#/$defs/stage"
            },
            {
              "type": "null"
            }
          ]
        },
        "to": {
          "$ref": "#/$defs/stage"
        },
        "candidateSha256": {
          "$ref": "#/$defs/sha256"
        },
        "evidenceIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "uniqueItems": true
        },
        "occurredAt": {
          "type": "string",
          "format": "date-time"
        },
        "actor": {
          "type": "string",
          "maxLength": 200
        }
      }
    }
  }
} as const;
export const schemas = {
  "agent-manifest": agentManifestSchema,
  "agent-lock": agentLockSchema,
  "eval-suite": evalSuiteSchema,
  "release-policy": releasePolicySchema,
  "workflow-state": workflowStateSchema,
} as const;
export type SchemaName = keyof typeof schemas;
