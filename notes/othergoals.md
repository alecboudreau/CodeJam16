Some notes of stuff to add etc.

-Add a groups page wherre you can select different groups

-form here you can add new new groups, join groups

-make it so you can update the specs document and add more people to group

-make the github linkning better, /link is kind of weird/annoying? better solution that dpoesnt involve texting in discord??

-make the UI better smoother/cleaner.

## Alec: C10 live email setup and verification

C10's email fallback is implemented on `c/38-email-nudges` in PR #79:
https://github.com/alecboudreau/CodeJam16/pull/79

Build, lint, bundle, and integration checks passed with mocked external providers. Live email delivery is deferred to Alec. No real test email has been sent, and Josh has not chosen a recipient yet.

- Configure the project's Resend account and verify its sending domain.
- Set server-only `RESEND_API_KEY` and `EMAIL_FROM` (a verified sender), plus the deployed app's `FRONTEND_URL`, in the Boudsdream Vercel project. Do not commit credentials.
- Merge/deploy C10 when ready. Deployment currently needs Alec's existing team access; Josh's membership request was blocked by the team's member limit.
- Agree on a test recipient before sending. Send one clearly labeled test reminder through the email fallback for a member with an email and no Discord link.
- Confirm provider acceptance and actual mailbox arrival, check the Inbox link and response flow, and confirm email delivery is not marked as Discord delivery.

Linked members continue to receive Discord DMs. Public demo check-ins without the presenter key suppress both email and Discord delivery.
