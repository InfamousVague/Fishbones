/// Smoke tests for the friends + leaderboard + profile UI. These
/// verify the three new surfaces mount and render their empty /
/// signed-out states without throwing — the "renders without crashing
/// when opened" check from the feature spec. Cloud methods are stubbed
/// to resolve empty (leaderboard / friends) or reject (profile load),
/// so no network is touched.

import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FriendsModal from "@/components/organisms/FriendsModal/FriendsModal";
import LeaderboardView from "@/components/templates/Leaderboard/LeaderboardView";
import ProfileCard from "@/components/molecules/ProfileCard/ProfileCard";
import type {
  FriendInfo,
  FriendRequest,
  LeaderboardEntry,
  PublicProfile,
} from "@/hooks/useLibreCloud";

describe("friends + leaderboard UI smoke", () => {
  it("FriendsModal renders its empty state", async () => {
    const listFriends = vi.fn(async (): Promise<FriendInfo[]> => []);
    const listFriendRequests = vi.fn(
      async (): Promise<FriendRequest[]> => [],
    );
    await act(async () => {
      render(
        <FriendsModal
          listFriends={listFriends}
          addFriend={async () => "sent"}
          listFriendRequests={listFriendRequests}
          acceptFriendRequest={async () => {}}
          removeFriend={async () => {}}
          onOpenProfile={() => {}}
          onClose={() => {}}
        />,
      );
    });
    await waitFor(() => expect(listFriends).toHaveBeenCalled());
    // The add-by-email affordance is always present.
    expect(
      screen.getByPlaceholderText("friend@example.com"),
    ).toBeTruthy();
    // Empty friends state copy.
    await waitFor(() =>
      expect(
        screen.getByText(
          "No friends yet. Add someone by email to compare progress.",
        ),
      ).toBeTruthy(),
    );
  });

  it("LeaderboardView renders friends-scope empty state", async () => {
    const getFriendsLeaderboard = vi.fn(
      async (): Promise<LeaderboardEntry[]> => [],
    );
    const getGlobalLeaderboard = vi.fn(
      async (): Promise<LeaderboardEntry[]> => [],
    );
    await act(async () => {
      render(
        <LeaderboardView
          getFriendsLeaderboard={getFriendsLeaderboard}
          getGlobalLeaderboard={getGlobalLeaderboard}
          onOpenProfile={() => {}}
          currentUserId={null}
        />,
      );
    });
    await waitFor(() =>
      expect(getFriendsLeaderboard).toHaveBeenCalledWith("xp"),
    );
    expect(screen.getByText("Leaderboard")).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByText("Add some friends to see a leaderboard here."),
      ).toBeTruthy(),
    );
  });

  it("LeaderboardView renders ranked rows", async () => {
    const rows: LeaderboardEntry[] = [
      {
        rank: 1,
        user_id: "u1",
        display_name: "Ada",
        total_xp: 1200,
        current_streak_days: 9,
        longest_streak_days: 20,
        lessons_completed: 60,
        level: 12,
      },
    ];
    await act(async () => {
      render(
        <LeaderboardView
          getFriendsLeaderboard={async () => rows}
          getGlobalLeaderboard={async () => []}
          onOpenProfile={() => {}}
          currentUserId={"u1"}
        />,
      );
    });
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    // Highlighted "You" chip for the current user's own row.
    expect(screen.getByText("You")).toBeTruthy();
  });

  it("ProfileCard renders a loaded profile with the Add-friend CTA", async () => {
    const profile: PublicProfile = {
      id: "u2",
      display_name: "Grace",
      email: "grace@example.com",
      created_at: "2025-01-15T00:00:00Z",
      stats: {
        total_xp: 300,
        current_streak_days: 4,
        longest_streak_days: 8,
        lessons_completed: 15,
        level: 5,
      },
      is_friend: false,
      friend_request_pending: false,
    };
    await act(async () => {
      render(
        <ProfileCard
          userId="u2"
          getProfile={async () => profile}
          onAddFriend={async () => {}}
          onRemoveFriend={async () => {}}
          onAcceptRequest={async () => {}}
          onClose={() => {}}
        />,
      );
    });
    await waitFor(() => expect(screen.getByText("Grace")).toBeTruthy());
    expect(screen.getByText("Add friend")).toBeTruthy();
  });
});
