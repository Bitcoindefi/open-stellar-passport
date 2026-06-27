interface DelegationState {
  claims: number;
  revoked: boolean;
}

export class DelegationStore {
  private state = new Map<string, DelegationState>();

  recordClaim(tokenId: string): void {
    const currentState = this.state.get(tokenId) || { claims: 0, revoked: false };
    currentState.claims += 1;
    this.state.set(tokenId, currentState);
  }

  revokeToken(tokenId: string): void {
    const currentState = this.state.get(tokenId) || { claims: 0, revoked: false };
    currentState.revoked = true;
    this.state.set(tokenId, currentState);
  }

  getClaims(tokenId: string): number {
    return this.state.get(tokenId)?.claims || 0;
  }

  isRevoked(tokenId: string): boolean {
    return this.state.get(tokenId)?.revoked || false;
  }
}

export const delegationStore = new DelegationStore();
