import { randomUUID } from "node:crypto";

import { YourSpotifyError } from "../../tools/errors/error";
import { ArtistGroupModel, ArtistModel } from "../Models";
import { Artist } from "../schemas/artist";
import { ArtistGroup } from "../schemas/artistGroup";

export class ArtistGroupError extends YourSpotifyError {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.type = status === 409 ? "CONFLICT" : "MALFORMED";
  }
  toJSON() {
    return { message: this.message, type: this.type };
  }
}

export type GroupArtist = Artist & {
  memberIds: string[];
  imageArtistId: string;
  members: Pick<Artist, "id" | "name" | "images">[];
};
type GroupState = { groups: ArtistGroup[]; artists: GroupArtist[] };
let cached:
  | { database: string; until: number; value: Promise<GroupState> }
  | undefined;

export function invalidateArtistGroups() {
  cached = undefined;
}

export function artistGroups() {
  const database = ArtistGroupModel.db.name;
  if (cached?.database === database && cached.until > Date.now())
    return cached.value;
  const value = (async () => {
    const groups = await ArtistGroupModel.find()
      .sort({ name: 1, id: 1 })
      .lean();
    const members = await ArtistModel.find({
      id: { $in: groups.flatMap((group) => group.memberIds) },
    }).lean();
    return {
      groups,
      artists: groups
        .filter((group) => group.enabled)
        .map((group) => ({
          id: group.id,
          name: group.name,
          images:
            members.find((member) => member.id === group.imageArtistId)
              ?.images ?? [],
          genres: [
            ...new Set(
              members
                .filter((member) => group.memberIds.includes(member.id))
                .flatMap((member) => member.genres ?? []),
            ),
          ],
          type: "artist",
          uri: "",
          href: "",
          external_urls: {},
          memberIds: group.memberIds,
          imageArtistId: group.imageArtistId,
          members: group.memberIds.flatMap((id) => {
            const member = members.find((item) => item.id === id);
            return member
              ? [{ id, name: member.name, images: member.images }]
              : [];
          }),
        })),
    };
  })();
  cached = { database, until: Date.now() + 5000, value };
  void value.catch(() => {
    if (cached?.value === value) cached = undefined;
  });
  return value;
}

export function groupedArtistId(id: string, artists: GroupArtist[]) {
  return (
    artists.find((artist) => artist.id === id || artist.memberIds.includes(id))
      ?.id ?? id
  );
}

export async function resolveArtistId(id: string) {
  return groupedArtistId(id, (await artistGroups()).artists);
}

export async function normalizeArtistCredits<T extends { artists: string[] }>(
  items: T[],
) {
  const { artists } = await artistGroups();
  return items.map((item) => ({
    ...item,
    artists: [
      ...new Set(item.artists.map((id) => groupedArtistId(id, artists))),
    ],
  }));
}

export async function artistMemberIds(id: string) {
  const { artists } = await artistGroups();
  return (
    artists.find((artist) => artist.id === id || artist.memberIds.includes(id))
      ?.memberIds ?? [id]
  );
}

export async function getStatisticsArtists(ids: string[]) {
  const { artists } = await artistGroups();
  const effective = [...new Set(ids.map((id) => groupedArtistId(id, artists)))];
  const originals = await ArtistModel.find({
    id: { $in: effective.filter((id) => !id.startsWith("group:")) },
  })
    .maxTimeMS(15_000)
    .lean();
  return [
    ...originals,
    ...artists.filter((artist) => effective.includes(artist.id)),
  ];
}

export async function populateStatisticsArtists<
  T extends { artists: string[] },
>(items: T[]) {
  const normalized = await normalizeArtistCredits(items);
  const metadata = await getStatisticsArtists(
    normalized.flatMap((item) => item.artists),
  );
  const byId = new Map(metadata.map((artist) => [artist.id, artist]));
  return normalized.map((item) => ({
    ...item,
    full_artists: item.artists.flatMap((id) => {
      const artist = byId.get(id);
      return artist ? [artist] : [];
    }),
  }));
}

export async function saveArtistGroup(
  input: Omit<ArtistGroup, "id" | "revision">,
  id?: string,
  revision?: number,
) {
  if (
    input.memberIds.length < 2 ||
    new Set(input.memberIds).size !== input.memberIds.length
  )
    throw new ArtistGroupError("Choose at least two different artists.");
  if (!input.memberIds.includes(input.imageArtistId))
    throw new ArtistGroupError("Choose an image from a member of the group.");
  const members = await ArtistModel.countDocuments({
    id: { $in: input.memberIds },
  });
  if (
    members !== input.memberIds.length ||
    input.memberIds.some((member) => member.startsWith("group:"))
  )
    throw new ArtistGroupError(
      "Choose artists from the library; groups cannot contain groups.",
    );
  try {
    const saved = id
      ? await ArtistGroupModel.findOneAndUpdate(
          { id, revision },
          { $set: input, $inc: { revision: 1 } },
          { returnDocument: "after" },
        ).lean()
      : (
          await ArtistGroupModel.create({
            ...input,
            id: `group:${randomUUID()}`,
          })
        ).toObject();
    if (!saved)
      throw new ArtistGroupError(
        "This group changed. Reload it before saving.",
        409,
      );
    invalidateArtistGroups();
    return saved;
  } catch (error) {
    if (error.code === 11000)
      throw new ArtistGroupError(
        "An artist already belongs to another group.",
        409,
      );
    throw error;
  }
}

export async function deleteArtistGroup(id: string, revision: number) {
  const result = await ArtistGroupModel.deleteOne({ id, revision });
  if (!result.deletedCount)
    throw new ArtistGroupError(
      "This group changed. Reload it before deleting.",
      409,
    );
  invalidateArtistGroups();
}
