import fs from "fs";
import path from "path";
import matter from "gray-matter";

const contentDirectory = path.join(process.cwd(), "src", "content");

export interface ContentPage {
  slug: string;
  frontmatter: Record<string, string>;
  content: string;
}

export function getContentPage(slug: string): ContentPage {
  const mdPath = path.join(contentDirectory, `${slug}.md`);
  const mdxPath = path.join(contentDirectory, `${slug}.mdx`);

  let filePath: string;
  if (fs.existsSync(mdxPath)) {
    filePath = mdxPath;
  } else if (fs.existsSync(mdPath)) {
    filePath = mdPath;
  } else {
    throw new Error(`Content page not found: ${slug}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);

  return { slug, frontmatter: data as Record<string, string>, content };
}
