const RELEVANT_TABLE_SCAN =
  /^SCAN serial_(view_feeds|view_categories|feed_categories|feed|feed_item)\b/;
const DIRECT_MEMBERSHIP_PATH =
  /SEARCH serial_view_feeds[^\n]*\nSEARCH serial_feed [^\n]*\nSEARCH serial_feed_item[^\n]*/g;
const TAG_MEMBERSHIP_PATH =
  /SEARCH serial_view_categories[^\n]*\nSEARCH serial_feed_categories[^\n]*\nSEARCH serial_feed [^\n]*\nSEARCH serial_feed_item[^\n]*/g;
const VISIBILITY_COUNT = 3;

export function evaluateNavigationViewAvailabilityPlan(
  planDetails: readonly string[],
) {
  const joinedPlan = planDetails.join("\n");
  const directMembershipPaths =
    joinedPlan.match(DIRECT_MEMBERSHIP_PATH)?.length ?? 0;
  const tagMembershipPaths = joinedPlan.match(TAG_MEMBERSHIP_PATH)?.length ?? 0;
  const missingIndexScans = planDetails.filter((detail) =>
    RELEVANT_TABLE_SCAN.test(detail),
  );

  return {
    membershipFirst:
      directMembershipPaths === VISIBILITY_COUNT &&
      tagMembershipPaths === VISIBILITY_COUNT,
    missingIndexScans,
  };
}
