/**
 * Marker parser for agent response text.
 * Mirrors Hermes parse_response() for full parity between runtimes.
 *
 * Supported markers (one per line, stripped from output):
 *   REACT:messageId:emoji[:remove]
 *   REPLY:messageId
 *   PROFILE:New Name
 *   PROFILEIMAGE:https://url
 *   METADATA:key=value
 *   MEDIA:/path/to/file  (can appear inline)
 */

export interface ParsedReaction {
  messageId: string;
  emoji: string;
  action: "add" | "remove";
}

export interface ParsedMarkers {
  text: string;
  reactions: ParsedReaction[];
  replyTo?: string;
  media: string[];
  profileName?: string;
  profileImage?: string;
  profileMetadata: Record<string, string>;
}

export function parseMarkers(raw: string): ParsedMarkers {
  const result: ParsedMarkers = {
    text: "",
    reactions: [],
    media: [],
    profileMetadata: {},
  };
  const lines = raw.split("\n");
  const kept: string[] = [];

  for (let line of lines) {
    const stripped = line.trim();

    // REACT:messageId:emoji or REACT:messageId:emoji:remove
    const reactMatch = stripped.match(/^REACT:([^:\s]+):([^:\s]+)(?::(remove))?$/);
    if (reactMatch) {
      result.reactions.push({
        messageId: reactMatch[1],
        emoji: reactMatch[2],
        action: reactMatch[3] ? "remove" : "add",
      });
      continue;
    }

    // REPLY:messageId — remaining text becomes the reply
    const replyMatch = stripped.match(/^REPLY:(\S+)$/);
    if (replyMatch) {
      result.replyTo = replyMatch[1];
      continue;
    }

    // PROFILE:name (optional leading dot, must not be PROFILEIMAGE:)
    const profileMatch = line.match(/\.?PROFILE:(.+)$/);
    if (profileMatch && !/PROFILEIMAGE:/.test(line)) {
      result.profileName = profileMatch[1].trim();
      continue;
    }

    // PROFILEIMAGE:url (optional leading dot)
    const imageMatch = line.match(/\.?PROFILEIMAGE:(https?:\/\/\S+)\s*$/);
    if (imageMatch) {
      result.profileImage = imageMatch[1];
      continue;
    }

    // METADATA:key=value
    const metaMatch = stripped.match(/^METADATA:(\w+)=(.+)$/);
    if (metaMatch) {
      result.profileMetadata[metaMatch[1]] = metaMatch[2].trim();
      continue;
    }

    // MEDIA:/path — can be inline, extract and keep rest of line
    const mediaMatch = line.match(/MEDIA:(\/\S+)/);
    if (mediaMatch) {
      result.media.push(mediaMatch[1]);
      line = line.slice(0, mediaMatch.index) + line.slice(mediaMatch.index! + mediaMatch[0].length);
      line = line.trim();
      if (!line) continue;
    }

    kept.push(line);
  }

  result.text = kept.join("\n").trim();
  return result;
}
