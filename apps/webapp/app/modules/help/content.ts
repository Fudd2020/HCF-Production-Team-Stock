/**
 * Help Centre content — the single source of truth for `/help`.
 *
 * Plain data, no server imports, so routes and components can both read it.
 * Add a topic here and it appears in the Help index, in search and at
 * `/help/<id>` with no other change.
 *
 * Topics are filtered by what the reader can actually reach, using the same
 * flags the sidebar gates on (`useUserRoleHelper`, and the layout loader's
 * `isAdmin` / `canUseBookings`). Keep the two in step: if
 * `use-sidebar-nav-items.tsx` changes who sees a section, change the matching
 * `visibleTo` here, or the Help Centre starts teaching screens that aren't
 * there.
 *
 * @see {@link file://./../../routes/_layout+/help._index.tsx} — the index
 * @see {@link file://./../../routes/_layout+/help.$topic.tsx} — one guide
 * @see {@link file://./../../routes/_layout+/help.faqs.tsx} — the FAQs
 */

/** Every guide. Used as the `$topic` route parameter, so keep these URL-safe. */
export type HelpTopicId =
  | "getting-started"
  | "roles"
  | "assets"
  | "kits"
  | "organising"
  | "bookings"
  | "audits"
  | "repairs"
  | "labels"
  | "scanner"
  | "reminders"
  | "reports"
  | "team"
  | "workspace-settings"
  | "updates";

/** How the index groups its guides. */
export type HelpGroup = "start" | "everyday" | "managing";

export const HELP_GROUP_LABELS: Record<HelpGroup, string> = {
  start: "Start here",
  everyday: "Using the system",
  managing: "Running the workspace",
};

/**
 * What the Help Centre knows about the reader.
 *
 * Mirrors the sidebar's gating inputs rather than raw roles, so a guide's
 * visibility rule can be written the same way the nav entry's `hidden` was.
 */
export type HelpAudience = {
  /** ADMIN or OWNER in the current workspace. */
  isAdministratorOrOwner: boolean;
  /** The SELF_SERVICE role. */
  isSelfService: boolean;
  /** BASE or SELF_SERVICE — the pair that share most restrictions. */
  isBaseOrSelfService: boolean;
  /** Global (instance) administrator, not a workspace role. */
  isAdmin: boolean;
  /** Whether bookings are available to this workspace. */
  canUseBookings: boolean;
};

/** One piece of a guide. The renderer decides how each kind is drawn. */
export type HelpBlock =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "definitions"; items: { term: string; detail: string }[] }
  | { kind: "tip"; text: string }
  | { kind: "warning"; text: string };

/** A single guide. */
export type HelpTopic = {
  id: HelpTopicId;
  title: string;
  /** One line, shown on the index card and in search results. */
  summary: string;
  group: HelpGroup;
  /** Whether this guide is worth showing at all. Mirrors the sidebar's gating. */
  visibleTo: (audience: HelpAudience) => boolean;
  /** The body. A function when the content differs by what the reader can do. */
  blocks: HelpBlock[] | ((audience: HelpAudience) => HelpBlock[]);
  /** Related guides, offered at the foot of the topic page. */
  related?: HelpTopicId[];
  /** Deep link into the feature itself, e.g. `/assets`. */
  featurePath?: string;
};

/** A frequently asked question. `topic` links it back to the fuller guide. */
export type HelpFaq = {
  id: string;
  question: string;
  answer: string;
  topic?: HelpTopicId;
  visibleTo?: (audience: HelpAudience) => boolean;
};

/** Everyone can read this guide. */
const anyone = () => true;

/* -------------------------------------------------------------------------- */
/*  The user guide                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Builds the walkthrough for a specific reader.
 *
 * Someone on BASE gets "find the thing, scan it, report it if it's broken";
 * an administrator also gets the setting-up-the-workspace pass.
 *
 * @param audience - What the reader can reach
 * @returns The blocks to render for them
 */
function buildGettingStarted(audience: HelpAudience): HelpBlock[] {
  const blocks: HelpBlock[] = [
    {
      kind: "text",
      text: "This is where the production team's equipment lives: what we own, where it is, who has it, what is booked, and what is broken. If it is in a flight case, it should be in here.",
    },
    { kind: "heading", text: "The three things that matter most" },
    {
      kind: "definitions",
      items: [
        {
          term: "Assets",
          detail:
            "One per physical thing — a microphone, a cable, a camera. Everything else hangs off these.",
        },
        {
          term: "Kits",
          detail:
            "A group of assets that travel together, so you book the whole radio-mic kit rather than seven items.",
        },
        {
          term: "Bookings",
          detail:
            "Reserving equipment for a date, so two people cannot promise the same desk to two services.",
        },
      ],
    },
    { kind: "heading", text: "Your first five minutes" },
    {
      kind: "steps",
      items: [
        "Open Assets and search for something you recognise — a mixer, a mic. That is the record for the real object.",
        "Open it and look at its overview: where it lives, who has custody, whether it is booked, and any faults.",
        "Try the QR Scanner from the sidebar and scan a label on a real case. It opens that item straight away.",
        "If something is broken, report a fault on it. That is what stops it being booked for Sunday.",
      ],
    },
    {
      kind: "tip",
      text: "The fastest way to find anything is to scan its label. Everything in the store room should carry one — and if it does not, print one.",
    },
  ];

  if (audience.canUseBookings) {
    blocks.push(
      { kind: "heading", text: "Booking equipment" },
      {
        kind: "bullets",
        items: [
          "Create a booking for the date you need the gear, then add the assets or kits to it.",
          "Anything already booked, out on custody or faulty will not be available — that is the point.",
          "Check the booking out when you take the equipment, and check it back in when it returns.",
          "A booking that is not checked back in shows as overdue, which is how missing gear gets noticed.",
        ],
      }
    );
  }

  if (!audience.isBaseOrSelfService) {
    blocks.push(
      { kind: "heading", text: "Keeping the data honest" },
      {
        kind: "bullets",
        items: [
          "Give every asset a category and a location — those two fields make everything else findable.",
          "Use tags for the cross-cutting things a category cannot express, like 'needs PAT test'.",
          "Run an audit periodically to check that what the system believes matches what is on the shelf.",
          "Set reminders for anything with a date attached: servicing, calibration, licence renewals.",
        ],
      }
    );
  }

  if (audience.isAdministratorOrOwner) {
    blocks.push(
      { kind: "heading", text: "Setting the workspace up" },
      {
        kind: "bullets",
        items: [
          "Invite the team under Team → Users, and give each person the narrowest role that lets them work.",
          "Add non-registered members for people who hold equipment but never sign in.",
          "Define custom fields for anything we track that Shelf does not have a box for.",
          "Print a sheet of QR labels and get them onto the gear — nothing else works properly until the labels are on.",
        ],
      }
    );
  }

  blocks.push(
    { kind: "heading", text: "Good habits" },
    {
      kind: "bullets",
      items: [
        "Report a fault the moment you find it, not after the service. It takes the item out of the bookable pool immediately.",
        "Check bookings in as the gear comes back, while the case is still in your hand.",
        "If you move something permanently, change its location. If you borrow it, take custody instead.",
      ],
    },
    {
      kind: "tip",
      text: "Most screens carry a short hint explaining what they are for, and Help is always in the sidebar.",
    }
  );

  return blocks;
}

/* -------------------------------------------------------------------------- */
/*  The guides                                                                */
/* -------------------------------------------------------------------------- */

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "getting-started",
    title: "Getting started",
    summary: "What this system is for, and the first things to do in it.",
    group: "start",
    visibleTo: anyone,
    blocks: buildGettingStarted,
    related: ["assets", "roles"],
  },
  {
    id: "roles",
    title: "Roles and permissions",
    summary: "What each role can do, and why a menu item might be missing.",
    group: "start",
    visibleTo: anyone,
    related: ["team"],
    blocks: [
      {
        kind: "text",
        text: "Everyone has one role in the workspace. It decides which parts of the sidebar appear and what you are allowed to change.",
      },
      {
        kind: "definitions",
        items: [
          {
            term: "Owner",
            detail:
              "Created the workspace. Everything an Administrator can do, and cannot be removed from it.",
          },
          {
            term: "Administrator",
            detail:
              "Full run of the workspace: assets, bookings, team, settings and workspace configuration.",
          },
          {
            term: "Self service",
            detail:
              "Books equipment for themselves and manages their own bookings. Does not see the organising screens — categories, tags, locations, reports.",
          },
          {
            term: "Base",
            detail:
              "The narrowest role. Works with the assets they are given and can report a fault, but does not administer anything.",
          },
        ],
      },
      { kind: "heading", text: "Why can't I see a screen?" },
      {
        kind: "text",
        text: "Sidebar entries you have no access to are hidden rather than greyed out, so a colleague's sidebar may be longer than yours. If you need something you cannot see, ask an administrator to change your role.",
      },
      {
        kind: "warning",
        text: "Hiding a menu entry is decoration. The real check happens on the server for every request, so a link someone sends you will still be refused if your role does not allow it.",
      },
    ],
  },
  {
    id: "assets",
    title: "Assets",
    summary: "The record for each physical thing we own, and everything on it.",
    group: "everyday",
    visibleTo: anyone,
    featurePath: "/assets",
    related: ["kits", "organising", "labels", "repairs"],
    blocks: [
      {
        kind: "text",
        text: "An asset is one physical thing. Open one and its overview tells you the whole story: where it lives, who has it, what it is booked for, its fault history, and any custom fields we have added.",
      },
      { kind: "heading", text: "Two kinds of asset" },
      {
        kind: "definitions",
        items: [
          {
            term: "Individual",
            detail:
              "One record, one object, tracked on its own — a specific mixing desk, a specific camera. It can only be in one place at a time.",
          },
          {
            term: "Quantity tracked",
            detail:
              "One record covering many identical units — 40 XLR cables. You track how many there are and how many are out, not which specific one.",
          },
        ],
      },
      {
        kind: "tip",
        text: "Choose individual when you would ever want to know which one, for example to keep a repair history against it. Cables that fail repeatedly are worth tracking individually for exactly that reason.",
      },
      { kind: "heading", text: "Custody" },
      {
        kind: "text",
        text: "Custody records that a person is holding an item outside a booking — a radio mic signed out to a speaker, a laptop with a team member. Assign it when the gear leaves, release it when it comes back.",
      },
      { kind: "heading", text: "Finding things" },
      {
        kind: "bullets",
        items: [
          "Search by name from the assets list.",
          "Filter by category, location, tag, status or custody.",
          "Scan the QR label — the fastest route when you have the object in your hand.",
        ],
      },
    ],
  },
  {
    id: "kits",
    title: "Kits",
    summary: "Groups of assets that travel together and get booked as one.",
    group: "everyday",
    visibleTo: anyone,
    featurePath: "/kits",
    related: ["assets", "bookings"],
    blocks: [
      {
        kind: "text",
        text: "A kit is a set of assets that live and move together — a radio mic kit, a camera kit. Booking the kit books everything in it, which is both quicker and harder to get wrong than remembering the seven parts.",
      },
      {
        kind: "bullets",
        items: [
          "Add assets to a kit, and they travel with it.",
          "A kit has its own location, and moving the kit moves the members with it.",
          "A kit whose member is out of action shows as degraded, so you find out before you pack it.",
          "An asset can be taken out of a kit at any time if it needs to be used on its own.",
        ],
      },
      {
        kind: "tip",
        text: "Kits earn their keep for anything you would otherwise write on a checklist. If the same six items always go out together, make them a kit.",
      },
    ],
  },
  {
    id: "organising",
    title: "Categories, tags and locations",
    summary: "The three ways equipment gets organised, and when to use each.",
    group: "everyday",
    visibleTo: (a) => !a.isBaseOrSelfService,
    featurePath: "/categories",
    related: ["assets", "audits"],
    blocks: [
      {
        kind: "text",
        text: "Three different jobs, easily confused. Getting them right is what makes the asset list searchable a year from now.",
      },
      {
        kind: "definitions",
        items: [
          {
            term: "Category",
            detail:
              "What a thing IS. One per asset — Microphones, Cables, Cameras. Pick a small set and stick to it.",
          },
          {
            term: "Tag",
            detail:
              "Anything else worth filtering on, and an asset can have many — 'needs PAT test', 'on loan', 'fragile'.",
          },
          {
            term: "Location",
            detail:
              "Where it physically lives when not in use — a store room, a rack, a flight case.",
          },
        ],
      },
      {
        kind: "tip",
        text: "If you find yourself wanting a second category for one asset, you want a tag.",
      },
      {
        kind: "warning",
        text: "Renaming a category or location changes it everywhere it is used. Deleting one leaves the assets that used it without one, so re-file them first.",
      },
    ],
  },
  {
    id: "bookings",
    title: "Bookings",
    summary: "Reserving equipment for a date, and checking it out and back in.",
    group: "everyday",
    visibleTo: (a) => a.canUseBookings,
    featurePath: "/bookings",
    related: ["assets", "kits", "reports"],
    blocks: [
      {
        kind: "text",
        text: "A booking reserves equipment for a period, so the same desk cannot be promised to two services. Everything the team is holding on a given Sunday should be on one.",
      },
      { kind: "heading", text: "The life of a booking" },
      {
        kind: "steps",
        items: [
          "Create the booking with its dates and who it is for.",
          "Add the assets and kits it needs. Anything already booked, held on custody or faulty will not be available.",
          "Reserve it, so the equipment is committed rather than pencilled in.",
          "Check it out when the gear physically leaves.",
          "Check it back in when it returns — this is the step people forget, and it is the one that matters.",
        ],
      },
      {
        kind: "warning",
        text: "A booking that passes its end date without being checked in is overdue, and the equipment stays unavailable to everyone else until somebody resolves it.",
      },
      {
        kind: "tip",
        text: "Use the calendar view to see the whole month at once — it is the quickest way to spot two things wanting the same kit.",
      },
    ],
  },
  {
    id: "audits",
    title: "Audits",
    summary:
      "Checking that what the system believes matches what is on the shelf.",
    group: "everyday",
    visibleTo: anyone,
    featurePath: "/audits",
    related: ["assets", "scanner"],
    blocks: [
      {
        kind: "text",
        text: "An audit is a stocktake. You walk the store room scanning labels, and the audit tells you what is missing, what turned up somewhere unexpected, and what nobody can find.",
      },
      {
        kind: "steps",
        items: [
          "Start an audit for the location or set of assets you are checking.",
          "Scan each item as you find it. The list updates as you go.",
          "Anything still unscanned at the end is what needs chasing.",
          "Record the condition of anything that has seen better days while you have it in your hand.",
        ],
      },
      {
        kind: "tip",
        text: "Audit one location at a time rather than everything at once. A finished audit of the mic cupboard is worth more than an abandoned audit of the building.",
      },
    ],
  },
  {
    id: "repairs",
    title: "Repairs and faults",
    summary: "Reporting broken gear, and keeping it out of the bookable pool.",
    group: "everyday",
    visibleTo: (a) => !a.isSelfService,
    featurePath: "/repairs",
    related: ["assets", "bookings"],
    blocks: [
      {
        kind: "text",
        text: "When something breaks, report it against the asset. That single act takes it out of the bookable pool immediately, so it cannot turn up at a service — which is the whole point of the feature.",
      },
      { kind: "heading", text: "Reporting a fault" },
      {
        kind: "bullets",
        items: [
          "Anyone who handles the gear can report a fault. You do not need to be an administrator.",
          "Describe what actually happened — 'crackles when you wiggle the connector' beats 'broken'.",
          "The team leads are emailed, and anyone with the item on an existing booking is warned.",
        ],
      },
      { kind: "heading", text: "What happens next" },
      {
        kind: "definitions",
        items: [
          {
            term: "Reported",
            detail: "The fault is known and the item is out of action.",
          },
          {
            term: "Diagnosed",
            detail: "Somebody has established what is actually wrong.",
          },
          {
            term: "Repaired",
            detail:
              "Fixed and returned to service, which puts it back in the bookable pool.",
          },
          {
            term: "Written off",
            detail:
              "Beyond repair. It stays out of the pool permanently — though it can be reinstated if that turns out to be wrong.",
          },
        ],
      },
      {
        kind: "tip",
        text: "Check the Repairs list before reporting: if the fault is already there, add to it rather than raising a second one.",
      },
      {
        kind: "text",
        text: "An asset's fault history stays on the asset, so a cable that fails three times is visible as a repeat offender instead of being rediagnosed from scratch each time.",
      },
    ],
  },
  {
    id: "labels",
    title: "Printing labels",
    summary: "Getting QR labels onto the gear, a sheet at a time.",
    group: "everyday",
    visibleTo: (a) => !a.isBaseOrSelfService,
    featurePath: "/assets",
    related: ["assets", "scanner"],
    blocks: [
      {
        kind: "text",
        text: "Every asset has a QR code, and the system only really works once those codes are on the physical objects. You can print a whole A4 sheet of them at once onto label stationery.",
      },
      {
        kind: "steps",
        items: [
          "Select the assets you want labels for from the assets list.",
          "Choose to print labels, and pick the position on the sheet to start at — so a part-used sheet gets finished rather than binned.",
          "Run the alignment check onto plain paper first.",
          "Hold it against a real label sheet, then print for real.",
        ],
      },
      {
        kind: "warning",
        text: "Check a label near the BOTTOM of the alignment test, not the top. A small error compounds down the page, so row one can look perfect while row ten is off the label entirely.",
      },
      {
        kind: "tip",
        text: "The alignment sheet includes a 100 mm rule. If it does not measure 100 mm, your printer is scaling the page — turn off 'fit to page' or 'shrink to fit' and print again.",
      },
    ],
  },
  {
    id: "scanner",
    title: "QR scanner",
    summary: "Point your phone at a label to open the item.",
    group: "everyday",
    visibleTo: anyone,
    featurePath: "/scanner",
    related: ["assets", "audits", "labels"],
    blocks: [
      {
        kind: "text",
        text: "The scanner turns a phone camera into the fastest way into any record. Scan the label on a case and you land on that asset or kit, with everything you can do to it.",
      },
      {
        kind: "bullets",
        items: [
          "Use it to look something up while you are standing in front of it.",
          "Use it during an audit to tick items off as you find them.",
          "Use it to add several items to a booking without typing.",
        ],
      },
      {
        kind: "warning",
        text: "Browsers only allow camera access over a secure connection. If the camera will not start, check you are on the https address rather than a plain http one.",
      },
    ],
  },
  {
    id: "reminders",
    title: "Reminders",
    summary:
      "Being told about servicing, calibration and renewals before they bite.",
    group: "everyday",
    visibleTo: (a) => !a.isBaseOrSelfService,
    featurePath: "/reminders",
    related: ["assets"],
    blocks: [
      {
        kind: "text",
        text: "A reminder is a date attached to an asset, with people to tell when it arrives. Use it for anything that comes round — PAT testing, servicing, calibration, licence renewals, warranty expiry.",
      },
      {
        kind: "bullets",
        items: [
          "Set a reminder from the asset itself, or from the Reminders screen.",
          "Choose who gets told. A reminder nobody receives is just a note.",
          "The Reminders screen is the list of what is coming up across everything.",
        ],
      },
      {
        kind: "tip",
        text: "Set the date for when the work needs doing, not the deadline. A reminder that arrives on the day the certificate expires is too late to be useful.",
      },
    ],
  },
  {
    id: "reports",
    title: "Reports",
    summary:
      "What is overdue, what is idle, what is booked, who is holding what.",
    group: "managing",
    visibleTo: (a) => !a.isBaseOrSelfService,
    featurePath: "/reports",
    related: ["bookings", "assets"],
    blocks: [
      {
        kind: "text",
        text: "Reports answer the questions a leader asks rather than the ones a screen happens to show. Each one covers a period you choose, or the current state where a period makes no sense.",
      },
      {
        kind: "definitions",
        items: [
          {
            term: "Overdue items",
            detail:
              "Equipment that should have come back and has not. Start here.",
          },
          {
            term: "Custody snapshot",
            detail: "Who is currently holding what, and for how long.",
          },
          {
            term: "Asset utilisation",
            detail:
              "How hard each item is working — the case for buying another, or for selling one.",
          },
          {
            term: "Idle assets",
            detail:
              "What has not moved in months. Often the most useful list in here.",
          },
          {
            term: "Booking compliance",
            detail:
              "Whether bookings are being checked out and back in on time.",
          },
        ],
      },
      {
        kind: "tip",
        text: "A report is only as honest as the check-ins behind it. If overdue looks alarming, the first question is whether gear is genuinely missing or simply never checked back in.",
      },
    ],
  },
  {
    id: "team",
    title: "Team",
    summary:
      "Inviting people, setting roles, and recording people who never sign in.",
    group: "managing",
    visibleTo: (a) => !a.isBaseOrSelfService,
    featurePath: "/settings/team/users",
    related: ["roles"],
    blocks: [
      {
        kind: "text",
        text: "Everyone who uses the system, and everyone who holds equipment, is recorded under Team.",
      },
      {
        kind: "definitions",
        items: [
          {
            term: "Users",
            detail:
              "People with an account who sign in. Each has a role that sets what they can do.",
          },
          {
            term: "Pending invites",
            detail:
              "People invited who have not accepted yet. Chase or revoke from here.",
          },
          {
            term: "Non-registered members",
            detail:
              "People who hold equipment but never sign in — a visiting engineer, a volunteer who only ever borrows. You can assign custody and bookings to them without creating an account.",
          },
        ],
      },
      {
        kind: "tip",
        text: "Give people the narrowest role that lets them do their job. It is easy to widen later and awkward to explain afterwards.",
      },
    ],
  },
  {
    id: "workspace-settings",
    title: "Workspace settings",
    summary:
      "Custom fields, asset models, booking rules and general configuration.",
    group: "managing",
    visibleTo: (a) => !a.isBaseOrSelfService,
    featurePath: "/settings/general",
    related: ["assets", "bookings"],
    blocks: [
      {
        kind: "definitions",
        items: [
          {
            term: "General",
            detail:
              "The workspace name, branding and the basics everyone sees.",
          },
          {
            term: "Custom fields",
            detail:
              "Extra boxes on every asset for the things we track that Shelf has no field for — impedance, channel count, PAT test date.",
          },
          {
            term: "Asset models",
            detail:
              "Shared make-and-model records, so twelve of the same microphone carry the same specification without retyping it.",
          },
          {
            term: "Bookings",
            detail:
              "How bookings behave for this workspace — working hours, rules and defaults.",
          },
        ],
      },
      {
        kind: "warning",
        text: "These settings apply to the whole workspace, not to you. Removing a custom field removes the data recorded in it on every asset.",
      },
      {
        kind: "tip",
        text: "Add a custom field only when you would actually filter or report on it. Anything you just want to remember belongs in the asset's description.",
      },
    ],
  },
  {
    id: "updates",
    title: "Updates",
    summary: "How you find out what changed after a release.",
    group: "start",
    visibleTo: anyone,
    featurePath: "/updates",
    blocks: [
      {
        kind: "text",
        text: "Updates is the release-notes feed. Every time the system is deployed with something new, a note appears there saying what you can now do — in plain terms, not a list of technical changes.",
      },
      {
        kind: "bullets",
        items: [
          "The bell in the sidebar marks unread notes.",
          "Notes are dated, newest first.",
          "Opening the feed marks them read.",
        ],
      },
      {
        kind: "tip",
        text: "If something on screen looks different from last week, Updates is the first place to check.",
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/*  FAQs                                                                      */
/* -------------------------------------------------------------------------- */

export const HELP_FAQS: HelpFaq[] = [
  {
    id: "faq-missing-menu",
    question: "Someone else has a menu item I don't. Why?",
    answer:
      "Sidebar entries are hidden when your role has no access to that section, rather than shown greyed out. Ask an administrator to check your role.",
    topic: "roles",
  },
  {
    id: "faq-individual-vs-quantity",
    question: "Should this be one asset or a quantity-tracked one?",
    answer:
      "Ask whether you would ever want to know WHICH one. A specific mixing desk, or a cable you want a repair history for, is individual. Forty identical patch cables you only count are quantity tracked.",
    topic: "assets",
  },
  {
    id: "faq-custody-vs-booking",
    question: "What's the difference between custody and a booking?",
    answer:
      "A booking reserves equipment for a date and is checked out and back in. Custody records that a person is simply holding something, with no end date. Use a booking for a service, custody for a laptop somebody keeps.",
    topic: "assets",
  },
  {
    id: "faq-category-vs-tag",
    question: "Category or tag?",
    answer:
      "A category is what a thing IS, and an asset has exactly one. A tag is anything else worth filtering on, and an asset can have many. If you want a second category, you want a tag.",
    topic: "organising",
  },
  {
    id: "faq-cant-book",
    question: "Why can't I add this asset to a booking?",
    answer:
      "Something already has it: another booking over the same dates, an open custody, or an unresolved fault. The asset's overview says which.",
    topic: "bookings",
  },
  {
    id: "faq-overdue",
    question: "A booking says overdue but the gear is back.",
    answer:
      "The equipment came back but the booking was never checked in. Check it in — that both clears the overdue flag and releases the assets for everyone else.",
    topic: "bookings",
  },
  {
    id: "faq-report-fault",
    question: "Do I need permission to report a fault?",
    answer:
      "No. Anyone who handles the gear can report one, deliberately — the person who finds the fault is usually not an administrator, and waiting for one is how broken kit reaches a service.",
    topic: "repairs",
  },
  {
    id: "faq-fault-blocks-booking",
    question: "I reported a fault and now nobody can book the item.",
    answer:
      "That is what it is for. An item with an open fault leaves the bookable pool until it is repaired or written off, so it cannot be reserved by somebody who does not know it is broken.",
    topic: "repairs",
  },
  {
    id: "faq-written-off-mistake",
    question: "Something was written off by mistake. Is it gone?",
    answer:
      "No. A written-off asset can be reinstated, which puts it back into the bookable pool with its history intact.",
    topic: "repairs",
  },
  {
    id: "faq-labels-misaligned",
    question: "My printed labels are drifting off the stationery.",
    answer:
      "Almost always the printer scaling the page. Print the alignment check on plain paper, measure its 100 mm rule, and if it is short turn off 'fit to page' or 'shrink to fit'. Check a label near the bottom of the sheet, since the error compounds down the page.",
    topic: "labels",
  },
  {
    id: "faq-part-sheet",
    question: "Can I use a label sheet I've already started?",
    answer:
      "Yes. When printing, choose the position to start at and the sheet is filled from there, so no stationery is wasted.",
    topic: "labels",
  },
  {
    id: "faq-scanner-camera",
    question: "The scanner won't turn my camera on.",
    answer:
      "Browsers only hand over the camera on a secure (https) connection, and you have to allow the permission when asked. Check the address, then check the site permissions in your browser settings.",
    topic: "scanner",
  },
  {
    id: "faq-audit-missing",
    question: "An audit says something is missing but I know where it is.",
    answer:
      "The audit only knows what has been scanned. Scan it, and if it lives somewhere other than where the system thinks, update its location while you are there.",
    topic: "audits",
  },
  {
    id: "faq-nrm",
    question: "How do I record someone who holds gear but never signs in?",
    answer:
      "Add them under Team as a non-registered member. You can assign custody and bookings to them without creating an account or sending an invite.",
    topic: "team",
  },
  {
    id: "faq-custom-field",
    question: "We track something there's no box for.",
    answer:
      "An administrator can add a custom field under Workspace settings, and it then appears on every asset. Add one only if you would filter or report on it — otherwise the description is the right home.",
    topic: "workspace-settings",
  },
  {
    id: "faq-whats-new",
    question: "How do I find out what changed in the app?",
    answer:
      "The Updates entry in the sidebar. Every release that changes something you can see or do gets a dated note there, and the bell marks the ones you have not read.",
    topic: "updates",
  },
];

/* -------------------------------------------------------------------------- */
/*  Lookups and search                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Finds a guide by its id.
 *
 * @param id - A topic id, typically straight from the route parameter
 * @returns The topic, or undefined if it isn't one we publish
 */
export function getHelpTopic(id: string | undefined): HelpTopic | undefined {
  return HELP_TOPICS.find((topic) => topic.id === id);
}

/**
 * The guides worth showing to a reader, in declaration order.
 *
 * @param audience - What the reader can reach
 */
export function helpTopicsFor(audience: HelpAudience): HelpTopic[] {
  return HELP_TOPICS.filter((topic) => topic.visibleTo(audience));
}

/**
 * The FAQs worth showing to a reader.
 *
 * A question inherits its topic's visibility unless it sets its own, so an
 * answer about a screen the reader cannot open never appears.
 *
 * @param audience - What the reader can reach
 */
export function helpFaqsFor(audience: HelpAudience): HelpFaq[] {
  return HELP_FAQS.filter((faq) => {
    if (faq.visibleTo) return faq.visibleTo(audience);
    if (!faq.topic) return true;
    return getHelpTopic(faq.topic)?.visibleTo(audience) ?? true;
  });
}

/**
 * Resolves a topic's body, running the builder when it is audience-aware.
 *
 * @param topic - The guide being rendered
 * @param audience - What the reader can reach
 */
export function helpBlocksFor(
  topic: HelpTopic,
  audience: HelpAudience
): HelpBlock[] {
  return typeof topic.blocks === "function"
    ? topic.blocks(audience)
    : topic.blocks;
}

/** Flattens a block into plain text so search can look inside it. */
function blockText(block: HelpBlock): string {
  switch (block.kind) {
    case "heading":
    case "text":
    case "tip":
    case "warning":
      return block.text;
    case "steps":
    case "bullets":
      return block.items.join(" ");
    case "definitions":
      return block.items.map((item) => `${item.term} ${item.detail}`).join(" ");
  }
}

export type HelpSearchResults = { topics: HelpTopic[]; faqs: HelpFaq[] };

/**
 * Searches the guides and FAQs a reader can see.
 *
 * Case-insensitive "contains every word" over the title, summary and full body
 * — deliberately forgiving, because people search for "cant book" rather than
 * the words we happened to write.
 *
 * @param query - What was typed; blank returns nothing
 * @param audience - Used to filter before matching
 */
export function searchHelp(
  query: string,
  audience: HelpAudience
): HelpSearchResults {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { topics: [], faqs: [] };

  const matches = (haystack: string) => {
    const lower = haystack.toLowerCase();
    return words.every((word) => lower.includes(word));
  };

  const topics = helpTopicsFor(audience).filter((topic) =>
    matches(
      [
        topic.title,
        topic.summary,
        ...helpBlocksFor(topic, audience).map(blockText),
      ].join(" ")
    )
  );
  const faqs = helpFaqsFor(audience).filter((faq) =>
    matches(`${faq.question} ${faq.answer}`)
  );

  return { topics, faqs };
}
