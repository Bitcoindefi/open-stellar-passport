import { NextRequest, NextResponse } from 'next/server';
import { validateDelegationToken, DelegationToken } from '../../../../../../sdk/src/delegation-token';
import { delegationStore } from '../../../../../../sdk/src/delegation-store';

export async function POST(request: NextRequest) {

  try {
    const token: DelegationToken = await request.json();

    const validation = validateDelegationToken(token);
    if (!validation.valid) {
      return NextResponse.json(
        { reason: validation.reason },
        { status: 401 }
      );
    }

    delegationStore.recordClaim(token.tokenId);

    return NextResponse.json({ success: true, reason: "claimed" }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ reason: "invalid_request" }, { status: 400 });
  }
}
