import {
  Avatar,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import { useState } from "react";

import BlacklistArtistDialog from "../../../components/BlacklistArtistDialog";
import ThreePoints from "../../../components/ThreePoints";
import { ThreePointItem } from "../../../components/ThreePoints/ThreePoints";
import { useSheetState } from "../../../services/hooks/hooks";
import { compact, conditionalEntry } from "../../../services/tools";
import { Artist } from "../../../services/types";

interface ArtistContextMenuProps {
  artistId: string;
  artistName: string;
  blacklisted: boolean;
  members?: Pick<Artist, "id" | "name" | "images">[];
}

export default function ArtistContextMenu({
  artistId,
  artistName,
  blacklisted,
  members,
}: ArtistContextMenuProps) {
  const [open, setOpen, setClosed] = useSheetState();
  const [showMembers, setShowMembers] = useState(false);

  const items: Array<ThreePointItem> = compact([
    conditionalEntry(
      { label: "Artists in this group", onClick: () => setShowMembers(true) },
      Boolean(members?.length),
    ),
    conditionalEntry(
      { label: "Blacklist", onClick: setOpen, style: "destructive" },
      !blacklisted,
    ),
    conditionalEntry(
      { label: "Unblacklist", onClick: setOpen, style: "destructive" },
      blacklisted,
    ),
  ]);

  return (
    <>
      <ThreePoints items={items} />
      <Dialog
        open={showMembers}
        onClose={() => setShowMembers(false)}
        fullWidth
        maxWidth="xs"
        aria-labelledby="group-members-title">
        <DialogTitle id="group-members-title">
          Artists in {artistName}
        </DialogTitle>
        <DialogContent>
          {members?.map((member) => (
            <Button
              key={member.id}
              component="a"
              href={`https://open.spotify.com/artist/${member.id}`}
              target="_blank"
              rel="noopener noreferrer"
              fullWidth
              sx={{
                justifyContent: "flex-start",
                gap: 2,
                marginBottom: 1,
                textTransform: "none",
              }}>
              <Avatar src={member.images.at(-1)?.url} alt="" />
              {member.name}
            </Button>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowMembers(false)}>Close</Button>
        </DialogActions>
      </Dialog>
      <BlacklistArtistDialog
        blacklisted={blacklisted}
        artistId={open ? artistId : undefined}
        artistName={artistName}
        onClose={setClosed}
      />
    </>
  );
}
