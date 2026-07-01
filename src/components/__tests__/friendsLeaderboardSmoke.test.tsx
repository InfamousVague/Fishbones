/// Smoke tests for the Social (friends + leaderboard) + profile UI.
/// These verify the surfaces mount and render their empty / loaded
/// states without throwing — the "renders without crashing when opened"
/// check from the feature spec. Cloud methods are stubbed to resolve
/// empty (leaderboard / friends) or resolve a fixture (profile), so no
/// network is touched.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SocialView from "@/components/templates/Social/SocialView";
import ProfileCard from "@/components/molecules/ProfileCard/ProfileCard";
import type {
  FriendInfo,
  FriendRequest,
  LeaderboardEntry,
  PublicProfile,
} from "@/hooks/useLibreCloud";

/// Build a SocialView with all cloud methods stubbed. Callers override
/// the ones the test cares about.
function renderSocial(
  overrides: Partial<React.ComponentProps<typeof SocialView>> = {},
) {
  const props: React.ComponentProps<typeof SocialView> = {
    listFriends: async (): Promise<FriendInfo[]> => [],
    addFriend: async () => "sent",
    listFriendRequests: async (): Promise<FriendRequest[]> => [],
    acceptFriendRequest: async () => {},
    removeFriend: async () => {},
    getFriendsLeaderboard: async (): Promise<LeaderboardEntry[]> => [],
    getGlobalLeaderboard: async (): Promise<LeaderboardEntry[]> => [],
    onOpenProfile: () => {},
    currentUserId: null,
    ...overrides,
  };
  return render(<SocialView {...props} />);
}

describe("Social + profile UI smoke", () => {
  it("SocialView renders the Friends tab empty state", async () => {
    const listFriends = vi.fn(async (): Promise<FriendInfo[]> => []);
    const listFriendRequests = vi.fn(
      async (): Promise<FriendRequest[]> => [],
    );
    await act(async () => {
      renderSocial({ listFriends, listFriendRequests });
    });
    await waitFor(() => expect(listFriends).toHaveBeenCalled());
    // The add-by-email affordance is present on the Friends tab.
    expect(screen.getByPlaceholderText("friend@example.com")).toBeTruthy();
    // Empty friends state copy.
    await waitFor(() =>
      expect(
        screen.getByText(
          "No friends yet. Add someone by email to compare progress.",
        ),
      ).toBeTruthy(),
    );
  });

  it("SocialView switches to the Leaderboard tab and shows its empty state", async () => {
    const getFriendsLeaderboard = vi.fn(
      async (): Promise<LeaderboardEntry[]> => [],
    );
    await act(async () => {
      renderSocial({ getFriendsLeaderboard });
    });
    // Switch to the Leaderboard tab.
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /Leaderboard/i }));
    });
    await waitFor(() =>
      expect(getFriendsLeaderboard).toHaveBeenCalledWith("xp"),
    );
    await waitFor(() =>
      expect(
        screen.getByText("Add some friends to see a leaderboard here."),
      ).toBeTruthy(),
    );
  });

  it("SocialView renders ranked leaderboard rows", async () => {
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
      renderSocial({
        getFriendsLeaderboard: async () => rows,
        currentUserId: "u1",
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /Leaderboard/i }));
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
