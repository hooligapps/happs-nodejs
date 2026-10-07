export interface ExternalIdentity {
  provider: "steam" | "portal" | "nutaku";
  external_id: string;
}
export interface Identity {
  game_id: string;
  user_id: string;
  external: ExternalIdentity | null;
  signature_version: 1;
  signature: string;
}
export type AssignmentState = "ACCEPTED" | "EXPIRED" | "COMPLETED" | "REWARDED" | "FAILED";
export interface Assignment {
  offer_id: string;
  assignment_id: string;
  state: AssignmentState;
  expires_at: string | null;
}
export interface AssignmentsResponse {
  request_id?: string;
  assignments: Assignment[];
}
export interface CompletionResponse {
  request_id: string;
  assignment_id: string;
  state: AssignmentState;
  completed_at: string;
  duplicate: boolean;
}
export type Reward =
  | {
      type: "currency";
      currency_id: string;
      amount: number;
    }
  | {
      type: "package";
      package_id: string;
    };
export interface RewardGrant {
  grant_id: string;
  assignment_id: string;
  offer_id: string;
  campaign_id: string | null;
  source_game_id: string;
  user_id: string;
  reward: Reward;
  offer_content: {
    locale: string;
    title: string;
    description: string;
    reward_text: string | null;
  };
  completed_at: string;
}
export interface RewardRequest {
  rawBody: Uint8Array;
  path: string;
  timestamp: string | undefined;
  signature: string | undefined;
  method?: string;
}
export interface XOffersClientOptions {
  baseUrl: string;
  gameId: string;
  secret: string;
  timeout?: number;
}
export interface ServerErrorResponse {
  request_id?: string;
  error: {
    code: string;
    message?: string;
  };
}
export class XOffersApiError extends Error {
  readonly status: number;
  readonly response: ServerErrorResponse | undefined;
  constructor(status: number, response?: ServerErrorResponse);
}
export function createIdentitySignature(
  gameId: string,
  userId: string,
  secret: string,
  external?: ExternalIdentity | null,
): string;
/** Verifies the original webhook body. The game handles rewards and duplicate deliveries. */
export function verifyRewardRequest(secret: string, request: RewardRequest): boolean;
export class XOffersClient {
  constructor(options: XOffersClientOptions);
  signIdentity(userId: string, external?: ExternalIdentity | null): Identity;
  verifyReward(request: RewardRequest): boolean;
  queryAssignments(
    userId: string,
    origin?: string | null,
    states?: AssignmentState[],
  ): Promise<AssignmentsResponse>;
  completeOffer(userId: string, offerId: string): Promise<CompletionResponse>;
}
