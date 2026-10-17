// Keep email-bound invitation context across Clerk sign-in/sign-up redirects.
// Only carry the token to our own dashboard; never trust a supplied redirect URL.
export function invitationRedirect(search: string) {
  const token = new URLSearchParams(search).get("invite");
  return token && token.length <= 200
    ? "/dashboard?" + new URLSearchParams({ invite: token }).toString()
    : "/dashboard";
}
