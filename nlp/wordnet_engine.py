import json 
from pathlib import Path

class WordNetEngine():
    def __init__(self, data_path : str="data/word_bank.json"):
        path = Path(data_path)
        if not path.exists():
            raise FileNotFoundError(f"Dataset not found at: {path.resolve()}")

        with open(path, "r", encoding="utf-8") as f:
            self.data = json.load(f)

    def count_entries(self) -> int:               #This function will give all the words to the var data created in the 
        return len(self.data)                      # __init__() as self.data 

    def get_word(self, word : str) -> dict | None:                 # here this func will return all the data into dict form 
        return self.data.get(word.lower().strip())                 # we used return type as dict|None: it either return a dict for a word or None


#Continue from here___------------_____-----------
    def get_senses(self, word : str) -> list[str]:
        word_entry = self.get_word(word)                     #all words data will be stored under this var
        if not word_entry:                                      #if it is a None then empty list will be returned  
            return []

        synsets = []
        for pos,pos_details in word_entry.items():
            if isinstance(pos_details,dict) and "sense" in pos_details:       # it checks whether the key of that word dict 
                senses_list = pos_details["sense"]
                if isinstance(senses_list, list):
                    for sense_entry in senses_list:                            # is also a dict and has the name "senses" 
                        if isinstance(sense_entry, dict) and "synset" in sense_entry:
                            synsets.append(sense_entry["synset"])                     #synset id will be stored in a list of synsets   

        return list(dict.fromkeys(synsets))          #this basically removes duplicates 


    def get_synset(self, synset_id : str) -> dict | None:
        if not synset_id or not isinstance(synset_id, str):
            return None

        if "synsets" in self.data and isinstance(self.data["synsets"], dict):
            if synset_id in self.data["synsets"]:
                return self.data["synsets"][synset_id]

        result = self.data.get(synset_id)
        if isinstance(result, dict):
            return result 
        return None 

    def get_definition(self, target : str) -> str|None:
        found_synset = self.get_synset(target)

        if not found_synset:
            senses = self.get_senses(target)
            if senses:
                found_synset = self.get_synset(senses[0])

        if found_synset and isinstance(found_synset, dict):
            defs = found_synset.get("definition", [])
            return defs[0] if defs else None
        return None

    def get_examples(self, target:str) -> list[str] :
        found_synset = self.get_synset(target)
        
        if not found_synset:
            senses = self.get_senses(target)
            if senses:
                found_synset = self.get_synset(senses[0])

        if found_synset and isinstance(found_synset, dict):
            return found_synset.get("example", [])

        return []

    def get_antonyms(self, target: str) -> list[str]:
        found_synset = self.get_synset(target)

        if not found_synset:
            senses = self.get_senses(target)
            if senses:
                found_synset = self.get_synset(senses[0])

        if found_synset and isinstance(found_synset, dict):
            return found_synset.get("<actual_field_name>", [])

        return []


        ##----------- VERIFICATION ------------
if __name__ == "__main__":
    try:
        engine = WordNetEngine("data/word_bank.json")

        print(f"Total Root Entries Loaded: {engine.count_entries()}\n")

        target_word = "honda"
        print(f"Querying word : {target_word}")

        word_data = engine.get_word(target_word)
        if word_data:
            print(f"Found POS categories: {list(word_data.keys())}")

        senses = engine.get_senses(target_word)
        print(f"Senses : {senses}\n")

        if senses:
            primary_synset = senses[0]
            print("--- Primary Sense Details ---")
            print(f"Synset ID:  {primary_synset}")
            print(f"Definition: {engine.get_definition(primary_synset)}")
            print(f"Examples:   {engine.get_examples(primary_synset)}")

    except FileNotFoundError as e:
        print(f"ERROR : {e}")
    