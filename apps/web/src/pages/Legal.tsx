import { useEffect, useState, type MouseEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLanguage } from "../lib/appContext";
import NotFound from "./NotFound";
import { Group, SetRow, SubPage } from "./Profile";

const TITLES: Record<string, [string, string]> = {
  terms: ["利用規約", "Terms"],
  privacy: ["プライバシーポリシー", "Privacy"],
  credits: ["クレジット", "Credits"],
  sales: ["特定商取引法に基づく表記", "Commercial disclosure"],
  refunds: ["解約・返金", "Refunds"],
};

type LegalDoc = { title: string; date?: string; toc: { id: string; text: string }[]; body: string };

/** The static /legal pages stay the source; this lifts their content into the app. */
export function parseLegal(html: string): LegalDoc | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const h1 = doc.querySelector("h1");
  if (!h1) return null;
  const last = doc.body.lastElementChild;
  const date = last?.textContent?.match(/^\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  if (date) last?.remove();
  const title = h1.textContent ?? "";
  doc.querySelectorAll("h1, nav, style").forEach((node) => node.remove());
  doc.querySelectorAll("a[href]").forEach((a) => {
    const name = a.getAttribute("href")?.match(/^([a-z]+)\.html$/)?.[1];
    if (name) a.setAttribute("href", `/profile/legal/${name}`);
  });
  const toc = [...doc.querySelectorAll("h2")].map((h2, i) => {
    h2.id = `legal-${i}`;
    return { id: h2.id, text: h2.textContent ?? "" };
  });
  return { title, date, toc, body: doc.body.innerHTML };
}

export default function Legal() {
  const en = useLanguage() === "en";
  const { doc = "" } = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState<LegalDoc | "failed" | null>(null);
  const titles = TITLES[doc];

  useEffect(() => {
    if (!titles) return;
    let active = true;
    setPage(null);
    fetch(`${import.meta.env.BASE_URL}legal/${en ? "en/" : ""}${doc}.html`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
      .then((html) => { if (active) setPage(parseLegal(html) ?? "failed"); })
      .catch(() => { if (active) setPage("failed"); });
    return () => { active = false; };
  }, [doc, en, titles]);

  if (!titles) return <NotFound />;

  const followLink = (e: MouseEvent) => {
    const href = (e.target as Element).closest("a")?.getAttribute("href");
    if (href?.startsWith("/profile/legal/")) { e.preventDefault(); navigate(href); }
  };

  return (
    <SubPage title={titles[en ? 1 : 0]}>
      {page === null && <p role="status" className="k-legal__note">{en ? "Loading…" : "読み込んでいます…"}</p>}
      {page === "failed" && <p role="alert" className="k-legal__note">{en ? "Could not load this page." : "読み込めませんでした。"}</p>}
      {page && page !== "failed" && <article className="k-legal">
        <h2 className="k-legal__title">{page.title}</h2>
        {page.date && <p className="k-legal__date">{en ? `Last updated: ${page.date}` : `最終更新：${page.date.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, "$1年$2月$3日")}`}</p>}
        {page.toc.length > 0 && <nav aria-label={en ? "Contents" : "目次"}><Group>
          {page.toc.map((item) => <SetRow key={item.id} label={item.text} onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth" })} />)}
        </Group></nav>}
        {/* Same-origin static file from public/legal, parsed inertly above. */}
        <div className="k-legal__body" onClick={followLink} dangerouslySetInnerHTML={{ __html: page.body }} />
      </article>}
    </SubPage>
  );
}
