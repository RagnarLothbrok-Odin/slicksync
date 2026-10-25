"use client";

import { InformationCircleIcon } from "@heroicons/react/24/outline";
import { PageSection } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui";

const link = "text-primary hover:underline";

const PEOPLE = [
    {
        href: "https://github.com/iamneur0",
        name: "iamneur0",
        what: (
            <>
                created{" "}
                <a
                    className={link}
                    href="https://github.com/iamneur0/syncio"
                    rel="noreferrer"
                    target="_blank"
                >
                    Syncio
                </a>
                , the engine SlickSync is built on.
            </>
        ),
    },
    {
        href: "https://github.com/Avangelista",
        name: "Avangelista",
        what: <>the ideas behind signing in to Nuvio.</>,
    },
    {
        href: "https://github.com/Sonicx161/AIOManager",
        name: "Sonicx161",
        what: <>created AIOManager, which inspired the Vault.</>,
    },
    { href: "https://github.com/0xConstant1", name: "0xConstant1", what: <>created LumiereDB.</> },
    {
        href: "https://github.com/cedya77/aiometadata",
        name: "cedya77",
        what: <>created AIOMetadata, whose LumiereDB guide this follows.</>,
    },
];

/** Settings -> About: who SlickSync is built on, and where its data comes from. */
export function AboutPanel({ lumiere, shared }: { lumiere: boolean; shared: boolean }) {
    return (
        <PageSection className="mb-6">
            <Card padding="lg">
                <div className="mb-5 flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-muted">
                        <InformationCircleIcon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                        <h3 className="font-display font-semibold text-base text-default">About</h3>
                        <p className="text-muted text-xs">Credits, data sources and privacy.</p>
                    </div>
                </div>

                <h4 className="mb-2 font-semibold text-default text-sm">Credits</h4>
                <ul className="mb-5 space-y-1.5 text-muted text-sm">
                    {PEOPLE.map((p) => (
                        <li key={p.name}>
                            <a
                                className={`${link} font-medium`}
                                href={p.href}
                                rel="noreferrer"
                                target="_blank"
                            >
                                {p.name}
                            </a>{" "}
                            - {p.what}
                        </li>
                    ))}
                </ul>

                <h4 className="mb-2 font-semibold text-default text-sm">Data</h4>
                <ul className="space-y-1.5 text-muted text-sm">
                    {lumiere && (
                        <li>
                            Titles from LumiereDB come from IMDb&apos;s public datasets, under
                            IMDb&apos;s terms for personal, non-commercial use - which ask for this
                            exact line: &ldquo;Information courtesy of IMDb (
                            <a
                                className={link}
                                href="https://www.imdb.com"
                                rel="noreferrer"
                                target="_blank"
                            >
                                https://www.imdb.com
                            </a>
                            ). Used with permission.&rdquo;
                        </li>
                    )}
                    <li>
                        This product uses the TMDB API but is not endorsed or certified by TMDB.
                    </li>
                    <li>
                        Titles and posters also come from Cinemeta and, with your own keys, OMDb,
                        MDBList and RPDB.
                    </li>
                </ul>

                <h4 className="mt-5 mb-2 font-semibold text-default text-sm">Privacy</h4>
                <div className="space-y-2 text-muted text-sm">
                    <p>
                        Everything SlickSync keeps - accounts, watch history, keys - is stored in
                        this instance&apos;s own database, on the server it runs on. Nothing is sent
                        back to the SlickSync project or its developer. It only talks to the
                        services you connect (Stremio, Nuvio, Jellyfin, TMDB and the rest) and to
                        GitHub, to check for new versions.
                    </p>
                    {shared && (
                        <div className="space-y-2 rounded-xl border border-default p-3">
                            <p className="font-medium text-default">
                                This is a shared instance, run by someone else
                            </p>
                            <p>
                                They run the server, so they can reach what&apos;s stored on it -
                                not only what SlickSync shows them:
                            </p>
                            <ul className="list-disc space-y-1 pl-5">
                                <li>
                                    Their admin page lists every account: its id and name, when it
                                    was made and last signed in to, and how many people, groups,
                                    addons and records it has. From there they can switch an account
                                    off, delete it, or send every account a notice.
                                </li>
                                <li>
                                    The database holds what you add here: your sign-ins to Stremio,
                                    Nuvio and the rest, addons, watch history, catalogs, settings
                                    and keys. Sign-ins and keys are encrypted, but with this
                                    server&apos;s own key, so whoever runs the server could read
                                    them.
                                </li>
                                <li>
                                    The server&apos;s logs note what SlickSync is doing, such as
                                    failed syncs - some lines name a person or a title. Email
                                    addresses are left out of them.
                                </li>
                            </ul>
                            <p>
                                Nothing else is collected, and nothing goes to the SlickSync
                                project. Use a shared instance run by someone you trust.
                            </p>
                            <p>
                                To cut off access at any time, delete your account here (Settings →
                                Security → Delete Account). Then sign SlickSync out from your
                                Stremio, Nuvio or Jellyfin account, or change that account&apos;s
                                password, so its old sign-in stops working.
                            </p>
                        </div>
                    )}
                </div>

                <div className="mt-5 space-y-1 border-default border-t pt-4 text-subtle text-xs">
                    <p>
                        © 2025-present slicknsliding. SlickSync is free software under the MIT
                        licence, built on Syncio © 2025 neur0.
                    </p>
                    <p>
                        SlickSync isn&apos;t affiliated with or endorsed by Stremio, Nuvio,
                        Jellyfin, IMDb or TMDB.
                    </p>
                </div>
            </Card>
        </PageSection>
    );
}
