/**
 * Bulletproof email button. Email clients (notably Apple Mail and some
 * webmail) strip a background set on an <a>, collapsing it to a plain
 * underlined link. Putting the background on a <td> with a white link
 * inside renders as a real button across clients. Outlook ignores
 * border-radius (square corners) but still shows a solid button.
 *
 * Returns a <table>, so don't nest the result inside a <p>.
 */
export function emailButton(opts: {
  href: string;
  label: string;
  /** Button background. Defaults to the brand sage. */
  bg?: string;
}): string {
  const bg = opts.bg ?? "#7c8b76";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0;">
        <tr>
          <td bgcolor="${bg}" style="border-radius:8px;">
            <a href="${opts.href}" style="display:inline-block; padding:12px 22px; color:#ffffff; font-weight:600; text-decoration:none; font-family:-apple-system,system-ui,sans-serif;">${opts.label}</a>
          </td>
        </tr>
      </table>`;
}
