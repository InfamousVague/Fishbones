/// Smoke tests for the Social (friends + leaderboard) + profile UI.
/// These verify the surfaces mount and render their empty / loaded
/// states without throwing — the "renders without crashing when opened"
/// check from the feature spec. Cloud methods are stubbed to resolve
/// empty (leaderboard / friends) or resolve a fixture (profile), so no
/// network is touched.
///
/// The page is built from Base kit primitives: the Friends ↔
/// Leaderboard switch is a kit SegmentedControl (role="radio" inside a
/// role="radiogroup", NOT role="tab"), buttons are kit <Button>s, and
/// avatars are kit <Avatar>s. Both tab panels stay mounted (the
/// inactive one is `hidden`) so switching never refetches.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SocialView from "@/components/templates/Social/SocialView";
import ProfileCard from "@/components/molecules/ProfileCard/ProfileCard";
import type {
  FriendInfo,
  FriendRequest,
  LeaderboardEntry,
  PublicProfile,
} from "@/hooks/useLibreCloud";

/// Own-profile fixture for the Friends-tab hero (embedded ProfileCard).
const ME: PublicProfile = {
  id: "me",
  display_name: "Linus",
  email: "linus@example.com",
  created_at: "2025-03-01T00:00:00Z",
  stats: {
    total_xp: 640,
    current_streak_days: 7,
    longest_streak_days: 12,
    lessons_completed: 30,
    level: 8,
  },
  is_friend: false,
  friend_request_pending: false,
};

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
    getProfile: async (): Promise<PublicProfile> => ME,
    onOpenProfile: () => {},
    currentUserId: "me",
    ...overrides,
  };
  return render(<SocialView {...props} />);
}

describe("Social + profile UI smoke", () => {
  it("SocialView renders the Friends tab empty state with its CTA", async () => {
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
    // Friendly empty state: title + "Add your first friend" CTA.
    await waitFor(() => expect(screen.getByText("No friends yet")).toBeTruthy());
    expect(
      screen.getByRole("button", { name: /Add your first friend/i }),
    ).toBeTruthy();
  });

  it("SocialView renders the signed-in user's own hero card", async () => {
    const getProfile = vi.fn(async (): Promise<PublicProfile> => ME);
    await act(async () => {
      renderSocial({ getProfile });
    });
    await waitFor(() => expect(getProfile).toHaveBeenCalledWith("me"));
    // Hero shows the own display name + a "You" badge.
    await waitFor(() => expect(screen.getByText("Linus")).toBeTruthy());
    expect(screen.getAllByText("You").length).toBeGreaterThan(0);
  });

  it("SocialView switches to the Leaderboard tab and shows its empty state", async () => {
    const getFriendsLeaderboard = vi.fn(
      async (): Promise<LeaderboardEntry[]> => [],
    );
    await act(async () => {
      renderSocial({ getFriendsLeaderboard });
    });
    // Switch tabs via the kit SegmentedControl (radio, not tab). The
    // "Leaderboard" radio only exists on the top-level control.
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Leaderboard" }));
    });
    await waitFor(() =>
      expect(getFriendsLeaderboard).toHaveBeenCalledWith("xp"),
    );
    await waitFor(() =>
      expect(
        screen.getByText("Add some friends to see a leaderboard here."),
      ).toBeTruthy(),
    );
    // Empty state offers a jump back to add friends.
    expect(screen.getByRole("button", { name: /Add friends/i })).toBeTruthy();
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
      fireEvent.click(screen.getByRole("radio", { name: "Leaderboard" }));
    });
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    // Highlighted "You" badge for the current user's own row (the
    // Friends-tab hero renders one too, hence getAllByText).
    expect(screen.getAllByText("You").length).toBeGreaterThan(0);
  });

  it("SocialView explains and offers sign-in when signed out", async () => {
    const onSignIn = vi.fn();
    await act(async () => {
      renderSocial({ currentUserId: null, onSignIn });
    });
    expect(screen.getByText("Sign in to go social")).toBeTruthy();
    // No tabs / add-by-email while signed out.
    expect(screen.queryByPlaceholderText("friend@example.com")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Sign in/i }));
    expect(onSignIn).toHaveBeenCalled();
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
    expect(
      screen.getByRole("button", { name: /Add friend/i }),
    ).toBeTruthy();
  });
});
