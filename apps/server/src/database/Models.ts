import { model } from "mongoose";

import { AlbumSchema } from "./schemas/album";
import { ArtistSchema } from "./schemas/artist";
import { ArtistGroupSchema } from "./schemas/artistGroup";
import { GlobalPreferencesSchema } from "./schemas/globalPreference";
import { ImporterStateSchema } from "./schemas/import";
import {
  ImportMappingSchema,
  ImportReviewSchema,
} from "./schemas/importReview";
import { InfosSchema } from "./schemas/info";
import { MigrationSchema } from "./schemas/migration";
import { PrivateDataSchema } from "./schemas/privateData";
import { TrackSchema } from "./schemas/track";
import { UserSchema } from "./schemas/user";

export const UserModel = model("User", UserSchema);
export const InfosModel = model("Infos", InfosSchema);
export const ArtistModel = model("Artist", ArtistSchema);
export const ArtistGroupModel = model("ArtistGroup", ArtistGroupSchema);
export const AlbumModel = model("Album", AlbumSchema);
export const TrackModel = model("Track", TrackSchema);
export const MigrationModel = model("Migration", MigrationSchema);
export const GlobalPreferencesModel = model(
  "GlobalPreference",
  GlobalPreferencesSchema,
);
export const ImporterStateModel = model("ImporterState", ImporterStateSchema);
export const PrivateDataModel = model("PrivateData", PrivateDataSchema);

export const ImportReviewModel = model("ImportReview", ImportReviewSchema);
export const ImportMappingModel = model("ImportMapping", ImportMappingSchema);
