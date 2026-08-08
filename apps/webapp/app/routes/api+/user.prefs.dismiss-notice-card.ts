/**
 * why: DELIBERATELY RETAINED but no longer reachable from the UI. The sidebar
 * notice card this endpoint dismissed (`components/layout/sidebar/notice-card.tsx`)
 * was deleted by the HCF rebrand — it advertised Shelf's PWA blog post, it was
 * never rendered anywhere, and its container was desktop-only. The endpoint and
 * the `hideNoticeCard` user-prefs cookie field are kept because removing them
 * buys an upstream merge conflict for zero user benefit (TL-7). Existing
 * cookies that already carry `hideNoticeCard: true` are harmless.
 */
import { type ActionFunctionArgs, data } from "react-router";
import { setCookie, userPrefs } from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const cookieHeader = request.headers.get("Cookie");
    const cookie = (await userPrefs.parse(cookieHeader)) || {};
    const bodyParams = await request.formData();

    if (bodyParams.get("noticeCardVisibility") === "hidden") {
      cookie.hideNoticeCard = true;
    }

    return data(payload({ success: true }), {
      headers: [setCookie(await userPrefs.serialize(cookie))],
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
