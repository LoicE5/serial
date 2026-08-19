let membershipRevision = 0;

export function getMixedContentMembershipRevision() {
  return membershipRevision;
}

export function advanceMixedContentMembershipRevision() {
  membershipRevision += 1;
  return membershipRevision;
}

export function isMixedContentMembershipRevisionStale(
  candidateRevision: number | undefined,
) {
  return (
    candidateRevision !== undefined && candidateRevision < membershipRevision
  );
}
