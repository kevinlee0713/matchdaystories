# Blog theme customization (matchdaystories.com)

The live site runs **ColorMag** with a newspaper ("Paper Portfolio") look driven entirely by
**Additional CSS**, stored in WordPress as the `custom_css` post **ID 180**. `custom.css` in this
folder is the source-of-truth mirror — edit it here, then push.

## Masthead structure (ColorMag header builder)
DOM order inside `#cm-masthead` (flex column, reordered by CSS):
1. `.mds-topbar` — "SEOUL, KR | date" (injected)
2. `.mds-nameplate` — giant "MATCHDAY" band (injected)
3. `.cm-row.cm-main-header` — holds the category menu (`#cm-primary-menu`)

`.cm-header-main-row` (the built-in site-title row) is hidden — the nameplate replaces it.
The category menu lives in a narrow `.cm-header-bottom-row .cm-header-left-col`; CSS forces that
chain full-width so the menu renders horizontally (otherwise it collapses to 1 char per line).

## Featured thumbnail
Cards are 1080×1350 (aspect 4/5). CSS pins `img.wp-post-image` to `aspect-ratio:4/5` so the whole
card (manga + title slab) shows without cropping.

## Update flow
```bash
# 1) edit blog/custom.css
# 2) push it to the live custom_css post (id 180) over SSH wp-cli:
source <(grep -E '^WP_SSH_|^WP_PATH' .env | sed 's/^/export /')
KEY="${WP_SSH_KEY_PATH/#\~/$HOME}"
SSH="ssh -i $KEY -o StrictHostKeyChecking=no $WP_SSH_USER@$WP_SSH_HOST"
cat blog/custom.css | $SSH "cat > /tmp/mds.css"
$SSH "cd $WP_PATH && wp eval '\$c=file_get_contents(\"/tmp/mds.css\"); wp_update_post([\"ID\"=>180,\"post_content\"=>\$c]);' && wp cache flush"
# 3) hard-refresh the site (Ctrl+F5)
```
Note: the host runs ModSecurity — fetch the live HTML with a full browser User-Agent or it returns
"Not Acceptable".
