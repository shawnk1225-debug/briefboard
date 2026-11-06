# Briefboard

A visual board for writing ad briefs with a small team: an infinite canvas with notes, documents,
nested boards, columns, tables, images, file attachments, video links, sketches, to-do lists and
arrows, plus comments and a web clipper. It runs as a static site on GitHub Pages and stores data
in Supabase.

Without Supabase connected it still runs, in browser-only mode: everything saves in that browser
and nobody else can see it.

## Connect Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, paste and run all of [`supabase/schema.sql`](supabase/schema.sql), then in new
   queries do the same with each file in [`supabase/migrations`](supabase/migrations), in order.
3. In the SQL Editor, add yourself as owner, using the email you'll log in with:

   ```sql
   insert into public.members (email, role) values ('you@example.com', 'owner');
   ```

4. In **Authentication → Sign In / Providers**, turn off **Allow new users to sign up**.
5. In **Authentication → Users → Add user → Create new user**, create your login with the same
   email, and tick **Auto Confirm User**.
6. In **Project Settings → API**, copy the Project URL and the public `anon` (or `publishable`)
   key. Add them in the GitHub repo under **Settings → Secrets and variables → Actions →
   Variables** as `SUPABASE_URL` and `SUPABASE_ANON_KEY`, then re-run the deploy workflow.

The public key is meant to be visible in the site's code. Access is enforced by the database rules
in `schema.sql`. Never put the `service_role` key in this repo or in a repo variable.

Boards made in browser-only mode don't move to Supabase automatically.

## Add a teammate

1. On the home page, open **Team** and add their email.
2. In Supabase, go to **Authentication → Users → Add user → Create new user**. Use the same email,
   a temporary password, and tick **Auto Confirm User**.
3. Send them the site link and password. They can change it under **Team**.

Both steps are needed: the Supabase login gets them in the door, and the Team list gives them access.

## Install the web clipper

The clipper is a Chrome extension in the [`extension`](extension) folder. It isn't on the Chrome Web
Store, so each person loads it once:

1. In Chrome, go to `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension` folder.
3. On the settings page that opens, enter your Briefboard site address and click **Save**.

To clip, click the extension's button to save the current page, or right-click a page, link, image
or selected text. Your site opens in a new tab, where you pick a board and click **Save**.

The extension can read images from any site, which is why Chrome asks for access to all websites.
It holds no login: saving happens on your site, under your normal sign-in.

## Good to know

- **The tutorial** is offered once to each person after they sign in, and **Tutorial** in the home
  sidebar replays it. It runs on a practice board that is never saved.
- **Secret links** let someone view a folder's boards and comment, with no account. Open a folder and
  click **Share**. Anyone with the link gets the same access, and comment names aren't verified. Turning
  a link off stops it right away, and turning it back on makes a new one. Comments marked **Team only**
  never reach a link.
- **Folders** go two levels deep: products, then batches. Deleting a folder never deletes boards;
  they move to Unfiled. Folders and labels are shared with the team, and pins are personal.
- **File attachments** are limited to 50 MB each, Supabase's free-plan limit. Use video links for
  anything longer, since uploads use up free storage quickly.
- **Comments** stay with a card if it's deleted and restored with undo, but aren't copied when a card
  or board is duplicated. Only a comment's author or the team owner can delete it.

- **Same-note edits:** teammates' changes appear within a few seconds. If two people edit the same
  note at the same moment, the last save wins.
- **Free tier:** Supabase may pause a free project after about a week without use. Restore it from
  the Supabase dashboard; nothing is lost. Check their current limits on storage.
- **Link previews:** YouTube, Vimeo and TikTok links get titles and players. Browsers block a static
  site from reading other pages, so other links show as a plain card with an editable title.
- **PDF and PNG exports** are images of the board, so PDF text isn't selectable. Use Markdown export
  for text.
- **Deleted images** stay in Supabase storage, so that undo and board copies keep working.

## Develop

```bash
npm install
npm run dev
```

```bash
npm test
```

To develop against Supabase, copy `.env.example` to `.env.local` and fill it in.

Pushing to `main` runs the tests and deploys to GitHub Pages.
