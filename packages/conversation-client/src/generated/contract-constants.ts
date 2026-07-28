/*
 * GENERATED FILE — do not edit by hand.
 * Source: docs/raia-devkit-spec/contracts/vendor/raia-external-api.openapi.json
 * Regenerate: pnpm --filter @raia/conversation-client generate
 * Drift check: pnpm --filter @raia/conversation-client check-sync
 */

/** SHA-256 of the byte-for-byte published vendor OpenAPI snapshot. */
export const RAW_CONTRACT_SHA256 = "fabbd26bf357ed184896d80a6ffd36c6f4873b42e8ae457ea0d0ae7a2c377cda";

/** SHA-256 of the audited projected contract that defines external-openapi-v1. */
export const PROJECTED_CONTRACT_SHA256 = "a76a1b2a1054f6a6c46443b60625da03667c9238f7559d547e9bdb94a44fb188";

export const CONTRACT_RETRIEVED_AT = "2026-07-27";

export const CONTRACT_SERVERS = {
  us: "https://api.raia2.com",
  eu: "https://api-eu.raia2.com",
} as const;

/** Security schemes published by the vendor contract. */
export const CONTRACT_SECURITY_SCHEMES = ["Agent-Secret-Key","Organization-Secret-Key","Super-Admin-Secret-Key"] as const;

/** operationId → wire method and path template, projected from the pinned contract. */
export const CONTRACT_OPERATIONS = {
  "ExternalApiConversationsController_getConversations": {
    "method": "GET",
    "path": "/external/conversations"
  },
  "ExternalApiConversationsController_createConversation": {
    "method": "POST",
    "path": "/external/conversations"
  },
  "ExternalApiConversationsController_deleteAllUsersConversations": {
    "method": "DELETE",
    "path": "/external/conversations"
  },
  "ExternalApiConversationsController_startConversation": {
    "method": "POST",
    "path": "/external/conversations/start"
  },
  "ExternalApiConversationsController_getConversationStates": {
    "method": "GET",
    "path": "/external/conversations/states"
  },
  "ExternalApiConversationsController_getConversationById": {
    "method": "GET",
    "path": "/external/conversations/{id}"
  },
  "ExternalApiConversationsController_updateConversation": {
    "method": "PUT",
    "path": "/external/conversations/{id}"
  },
  "ExternalApiConversationsController_createConversationMessageFileSignedUploadUrl": {
    "method": "POST",
    "path": "/external/conversations/{id}/message-files/upload-url"
  },
  "ExternalApiConversationsController_getConversationMessageFileSignedUrl": {
    "method": "GET",
    "path": "/external/conversations/{id}/message-files/{fileId}/signed-url"
  },
  "ExternalApiConversationsController_getConversationMessages": {
    "method": "GET",
    "path": "/external/conversations/{id}/messages"
  },
  "ExternalApiConversationsController_processMessage": {
    "method": "POST",
    "path": "/external/conversations/{id}/messages"
  },
  "ExternalApiConversationsController_sendMessage": {
    "method": "POST",
    "path": "/external/conversations/{id}/messages/async"
  },
  "ExternalApiConversationsController_getResponseOn": {
    "method": "GET",
    "path": "/external/conversations/{id}/messages/{questionMessageId}/response-on"
  },
  "ExternalApiConversationsController_updateConversationMode": {
    "method": "PUT",
    "path": "/external/conversations/{id}/mode"
  },
  "ExternalApiConversationsController_sendManualMessage": {
    "method": "POST",
    "path": "/external/conversations/{id}/send-manual-message"
  }
} as const;
