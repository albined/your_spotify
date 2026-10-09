import {
  Avatar,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import { useState } from "react";

import ThreePoints from "../../../components/ThreePoints";
import { Artist } from "../../../services/types";

interface ArtistContextMenuProps {
  artistName: string;
  members: Pick<Artist, "id" | "name" | "images">[];
}

export default function ArtistContextMenu({
  artistName,
  members,
}: ArtistContextMenuProps) {
  const [showMembers, setShowMembers] = useState(false);

  return (
    <>
      <ThreePoints
        items={[
          {
            label: "Artists in this group",
            onClick: () => setShowMembers(true),
          },
        ]}
      />
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
          {members.map((member) => (
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
    </>
  );
}
