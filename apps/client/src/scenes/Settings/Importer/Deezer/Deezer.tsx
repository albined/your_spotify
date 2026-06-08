import { useState } from "react";
import { Button, CircularProgress } from "@mui/material";
import { startImportDeezer } from "../../../../services/redux/modules/import/thunk";
import Text from "../../../../components/Text";
import { useAppDispatch } from "../../../../services/redux/tools";
import s from "./index.module.css";

export default function Deezer() {
  const dispatch = useAppDispatch();
  const [files, setFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);

  const onImport = async () => {
    setLoading(true);
    if (!files) {
      return;
    }
    await dispatch(startImportDeezer({ files }));
    setLoading(false);
  };

  const wrongFiles = (() => {
    if (!files) {
      return false;
    }
    return Array.from(Array(files.length).keys()).some(
      i => !files.item(i)?.name.endsWith(".xlsx"),
    );
  })();

  return (
    <div>
      <Text className={s.import} size='normal'>
        Here you can import your listening history exported from Deezer. 
        Please select and upload your exported <code>.xlsx</code> file. 
        The importer will extract track names, artist names, and ISRC codes to automatically map them to Spotify database objects.
      </Text>
      <label htmlFor="contained-button-file-deezer">
        <input
          accept=".xlsx"
          id="contained-button-file-deezer"
          multiple
          type="file"
          style={{ display: "none" }}
          onChange={ev => setFiles(ev.target.files)}
        />
        <Button component="span">
          Select your Deezer .xlsx file
        </Button>
      </label>
      {files &&
        Array.from(Array(files.length).keys()).map(i => (
          <Text key={i} element="div" size='normal'>
            {files.item(i)?.name}
          </Text>
        ))}
      {wrongFiles && (
        <Text className={s.alert} size='normal'>
          Some files are not Excel sheets (<code>.xlsx</code>), import might not work
        </Text>
      )}
      {files && !wrongFiles && (
        <Text className={s.noalert} size='normal'>
          Everything looks fine for the import to work
        </Text>
      )}
      {files && (
        <div className={s.importButton}>
          {!loading && (
            <Button variant="contained" onClick={() => onImport()}>
              Import
            </Button>
          )}
          {loading && <CircularProgress size={16} />}
        </div>
      )}
    </div>
  );
}
