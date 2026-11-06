// The Starter Book template as project data. It is a copy of the notes in templates/starter-book;
// a test reads that folder and checks both give the same book, so the two cannot drift apart.

import type { Project } from "./model";

export type ProjectDraft = Pick<Project, "meta" | "settings" | "sections" | "chapters" | "assets">;

export function starterBook(): ProjectDraft {
  return {
    meta: {
      title: "Starter Book",
      author: "Your Name",
      language: "en",
      copyright: "© 2026 Your Name. All rights reserved.",
    },
    settings: {
      theme: "classic",
      trim: "6x9",
      "chapter-start": "recto",
      "running-heads": "author-title",
      "scene-break": "* * *",
    },
    sections: [
      { kind: "front", chapterIds: ["dedication"] },
      { kind: "body", chapterIds: ["one", "two", "three"] },
      { kind: "back", chapterIds: ["about"] },
    ],
    chapters: [
      { id: "dedication", title: "Dedication", kind: "dedication", body: "For someone who made this possible." },
      {
        id: "one",
        title: "Chapter One",
        body: "Start writing here. A blank line starts a new paragraph.\n\n* * *\n\nThree asterisks on their own line make a scene break.",
      },
      { id: "two", title: "Chapter Two", body: "Keep going." },
      { id: "three", title: "Chapter Three", body: "Finish strong." },
      { id: "about", title: "About the author", kind: "about-the-author", body: "A short bio, written in the third person." },
    ],
    assets: [],
  };
}
