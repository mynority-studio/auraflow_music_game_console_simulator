# Impro-Visor 伴奏织体与风格核心代码

### File: src\imp\style\stylePatterns\Pattern.java

```java

/**
 * This Java Class is part of the Impro-Visor Application
 *
 * Copyright (C) 2005-2012 Robert Keller and Harvey Mudd College
 *
 * Impro-Visor is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * Impro-Visor is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * merchantability or fitness for a particular purpose.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Impro-Visor; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 */

package imp.style.stylePatterns;

import imp.style.Style;

/**
 * A Pattern is base class for accompaniment patterns that have
 * a certain duration and weight.
 * This simplifies the code for choosing a random pattern.
 * @see Style
 * @author Stephen Jones, converted by Robert Keller from Interface to Class 12/1/2007
 */

public class Pattern {
    /**
     * the Style this to which this Pattern belongs
     */
  
    protected Style style;

    /**
     * the weight
     */
    protected float weight = 10;

    
    private String errorMessage = null;


    /**
     * Gets the duration. This is intended to be overridden by specific types of Pattern.
     * @return the duration
     */
    
    public int getDuration()
    {
      return 0;
    }

    /**
     * Gets the weight.
     * @return the weight
     */
    
    public float getWeight()
    {
      return weight;
    }

    /**
     * Gets the Style.
     * @return the style
     */
    
    public Style getStyle()
    {
      return style;
    }

    /**
     * Sets the weight.
     * @param w         a float containing the weight
     */
    
    public void setWeight(float w)
    {
      weight = w;
    }

    /**
     * Sets the style.
     * @param s         the Style
     */
    
    public void setStyle(Style s)
    {
      style = s;
    }
    
public boolean getStatus()
  {
    return errorMessage == null;
  }

public String getErrorMessage()
  {
    return errorMessage == null ? "" : errorMessage;
  }

protected void setError(String error)
  {
    errorMessage = error;
  }
}

```

### File: src\imp\style\stylePatterns\ChordPattern.java

```java

/**
 * This Java Class is part of the Impro-Visor Application
 *
 * Copyright (C) 2005-2015 Robert Keller and Harvey Mudd College
 *
 * Impro-Visor is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * Impro-Visor is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * merchantability or fitness for a particular purpose.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Impro-Visor; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 */

package imp.style.stylePatterns;

import imp.data.Chord;
import imp.data.ChordForm;
import imp.data.ChordSymbol;
import imp.data.Duration;
import imp.data.Key;
import imp.data.Leadsheet;
import imp.data.MelodyPart;
import imp.data.Note;
import imp.data.NoteSymbol;
import imp.data.PitchClass;
import imp.data.Rest;
import imp.style.Style;
import imp.data.VolumeSymbol;
import imp.data.advice.ScaleForm;
import imp.data.advice.Advisor;
import imp.util.ErrorLog;
import imp.voicing.HandManager;
import imp.voicing.VoicingDebug;
import imp.voicing.VoicingDistanceCalculator;
import imp.voicing.VoicingGenerator;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Iterator;
import java.util.LinkedList;
import java.util.LinkedHashMap;
import polya.Polylist;
import polya.PolylistBuffer;
import polya.PolylistEnum;

/**
 * Contains a rhythmic pattern for use in a chord accompaniment and methods
 * needed to realize that rhythmic pattern with voice leading according
 * to a chord progression.
 * @see Style
 * @author Stephen Jones, Robert Keller, Carli Lessard
 */

public class ChordPattern
        extends Pattern implements Serializable
{
/**
 * the rules for the pattern, stored as indices into the ruleTypes array
 */
private ArrayList<String> rules;

/**
 * the durations for the pattern, stored as leadsheet representation of
 * rhythm
 */
private ArrayList<String> durations;

/**
 * the hash map that carries the rules defined in the style
 */
private LinkedHashMap<String, Polylist> definedRules = 
        new LinkedHashMap<String, Polylist>();

/**
 * array containing the types of rules
 */
private static final String ruleTypes[] =
  {
  "X", "R", "V", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"
  };

// indices into the ruleTypes array
private static final int STRIKE = 0;

private static final int REST = 1;

private static final int VOLUME = 2;

private static final String STRIKE_STRING = ruleTypes[STRIKE];

private static final String REST_STRING = ruleTypes[REST];

private static final String VOLUME_STRING = ruleTypes[VOLUME];

/**
 * array containing ChordPattern keywords
 */
private static final String keyword[] =
  {
  "rules", "weight", "push", "name", "use"
  };

// indices into the keyword array
private static final int RULES = 0;

private static final int WEIGHT = 1;

private static final int PUSH = 2;

private static final int NAME = 3;

private static final int USE = 4;

private String patternName = "";

private String pushString = "";

private int pushAmount = 0; // push amount, in slots


/**
 * Creates a new ChordPattern (only used by the factory).
 */
public ChordPattern()
  {
  rules = new ArrayList<String>();
  durations = new ArrayList<String>();
  }


/**
 * A factory for creating a ChordPattern from a Polylist.
 * @param L         a Polylist containing ChordPattern information
 * @return the ChordPattern created from the Polylist, or null if there
 *         was a problem
 */
public static ChordPattern makeChordPattern(Polylist L)
  {
    // Example of L:
    // 	(chord-pattern (rules P8 X1 R4 X2 X4)(weight 5)(push 8/3)
    //
    // X = "hit", R = "rest"
    // The notation for push is the same as a duration.
    // For example, 8/3 is an eighth-note triplet
    
  Polylist original = L;
    
  ChordPattern cp = new ChordPattern();

  while( L.nonEmpty() )
    {
    Polylist item = (Polylist)L.first();
    L = L.rest();

    String dispatcher = (String)item.first();
    item = item.rest();
    switch( Leadsheet.lookup(dispatcher, keyword) )
      {
      case NAME:
        {
           if( item == null || item.isEmpty() || item.first().equals("") )
           {
               break;
           }
           else if(item.first() instanceof String) 
           {
               cp.patternName = (String) item.first();
           }
           else
           {
               cp.setError("Unrecognized name type in chord pattern: " + item.first());
               return cp;
           }
           break;
        }
      case RULES:
        {
        while( item.nonEmpty() )
          {
          Object entry = item.first();
          item = item.rest();
          
          if( entry instanceof String )
            {
          String s = (String)entry;

          String rule = s.substring(0, 1);
          String dur = s.substring(1);
          
          char c = rule.charAt(0);
          
          switch( c )
            {
              case 'X':
              case 'R':
              case 'V':
                  cp.addRule(rule, dur);
                  break;
                  
              default:
                  cp.setError("Unrecognized " + rule 
                            + " in chord pattern " + original);
                  return cp;
            }
          
          //item = item.rest();
          }
          
                        // check to see if it is an S-expression
          else if( entry instanceof Polylist )
          {
              //e.g. (X 5 4)
              Polylist plist = (Polylist)entry;
              int len = plist.length();
                  
              // make sure it has 3 or more elements for a valid expression
              if( len >= 3 && plist.first().equals(ruleTypes[STRIKE]) )
              {
                  String rule = plist.second().toString();
                  //System.out.println(rule);
                  String duration = plist.third().toString();
                  //System.out.println(duration);
                  cp.addRule(rule, duration);
              }
              else
              {
                  cp.setError("unrecognized " + entry + " in chord pattern: " + original);
                  return cp;
              }
          }
          
          else
            {
                  cp.setError("Unrecognized " + item.first()
                            + " in chord pattern " + original);
                  return cp;              
            }
          }
        break;
        }
          
      case WEIGHT:
        {
        try
          {
          Number w = (Number)item.first();
          cp.setWeight(w.intValue());
          break;
          }
        catch( Exception e )
          {
            cp.setError("Expected weight value, but found " + item.first()
                      + " in " + original);
          }
        break;
        }
          
      case PUSH:
        {
        if( item.nonEmpty() )
          {
          cp.pushString = item.first().toString();
          cp.pushAmount = Duration.getDuration(cp.pushString);
        //System.out.println("pushAmount " + pushString + " = " + cp.pushAmount + " slots");
          }
        break;
        }
          
      default:
          cp.setError("Error in chord pattern " + original);
          return cp;
      }
    }
  //System.out.println("makeChordPattern on " + original + " returns " + cp);
  return cp;
  }


/**
 * A method that adds rules and durations to an existing bass pattern
 * Used in place of makeChordPattern when the Style has pre-defined rules
 * @param L
 * @return 
 */
public ChordPattern makePattern(Polylist L)
  {
    // Example of L:
    // 	(chord-pattern (rules P8 X1 R4 X2 X4)(weight 5)(push 8/3)
    //
    // X = "hit", R = "rest"
    // The notation for push is the same as a duration.
    // For example, 8/3 is an eighth-note triplet
    
  Polylist original = L;
    
  ChordPattern cp = this;

  while( L.nonEmpty() )
    {
    Polylist item = (Polylist)L.first();
    L = L.rest();

    String dispatcher = (String)item.first();
    item = item.rest();
    switch( Leadsheet.lookup(dispatcher, keyword) )
      {
      case NAME:
        {
           if( item == null || item.isEmpty() || item.first().equals("") )
           {
               break;
           }
           else if(item.first() instanceof String) 
           {
               cp.patternName = (String) item.first();
           }
           else
           {
               cp.setError("Unrecognized name type in chord pattern: " + item.first());
               return cp;
           }
           break;
        }
      case USE:
      {
          if( item.first() instanceof String )
                {
                    String name = (String) item.first();
                    cp.patternName = name;
                    LinkedHashMap ruleDefinitions = cp.getDefinedRules();
                    Polylist rules = (Polylist)ruleDefinitions.get( name );
                    String first = (String)rules.first();
                    if( Leadsheet.lookup(first, keyword) == RULES )
                    {
                        rules = rules.rest();
                        while( rules.nonEmpty() )
          {
          Object entry = rules.first();
          rules = rules.rest();
          
          if( entry instanceof String )
            {
          String s = (String)entry;

          String rule = s.substring(0, 1);
          String dur = s.substring(1);
          
          char c = rule.charAt(0);
          
          switch( c )
            {
              case 'X':
              case 'R':
              case 'V':
                  cp.addRule(rule, dur);
                  break;
                  
              default:
                  cp.setError("Unrecognized " + rule 
                            + " in chord pattern " + original);
                  return cp;
            }
          
          //item = item.rest();
          }
          
                        // check to see if it is an S-expression
          else if( entry instanceof Polylist )
          {
              //e.g. (X 5 4)
              Polylist plist = (Polylist)entry;
              int len = plist.length();
                  
              // make sure it has 3 or more elements for a valid expression
              if( len >= 3 && plist.first().equals(ruleTypes[STRIKE]) )
              {
                  String rule = plist.second().toString();
                  //System.out.println(rule);
                  String duration = plist.third().toString();
                  //System.out.println(duration);
                  cp.addRule(rule, duration);
              }
              else
              {
                  cp.setError("unrecognized " + entry + " in chord pattern: " + original);
                  return cp;
              }
          }
          
          else
            {
                  cp.setError("Unrecognized " + item.first()
                            + " in chord pattern " + original);
                  return cp;              
            }
          }
                    }
                }
          break;
      }
      case RULES:
        {
        while( item.nonEmpty() )
          {
          Object entry = item.first();
          item = item.rest();
          
          if( entry instanceof String )
            {
          String s = (String)entry;

          String rule = s.substring(0, 1);
          String dur = s.substring(1);
          
          char c = rule.charAt(0);
          
          switch( c )
            {
              case 'X':
              case 'R':
              case 'V':
                  cp.addRule(rule, dur);
                  break;
                  
              default:
                  cp.setError("Unrecognized " + rule 
                            + " in chord pattern " + original);
                  return cp;
            }
          
          //item = item.rest();
          }
          
                        // check to see if it is an S-expression
          else if( entry instanceof Polylist )
          {
              //e.g. (X 5 4)
              Polylist plist = (Polylist)entry;
              int len = plist.length();
                  
              // make sure it has 3 or more elements for a valid expression
              if( len >= 3 && plist.first().equals(ruleTypes[STRIKE]) )
              {
                  String rule = plist.second().toString();
                  //System.out.println(rule);
                  String duration = plist.third().toString();
                  //System.out.println(duration);
                  cp.addRule(rule, duration);
              }
              else
              {
                  cp.setError("unrecognized " + entry + " in chord pattern: " + original);
                  return cp;
              }
          }
          
          else
            {
                  cp.setError("Unrecognized " + item.first()
                            + " in chord pattern " + original);
                  return cp;              
            }
          }
        break;
        }
          
      case WEIGHT:
        {
        try
          {
          Number w = (Number)item.first();
          cp.setWeight(w.intValue());
          break;
          }
        catch( Exception e )
          {
            cp.setError("Expected weight value, but found " + item.first()
                      + " in " + original);
          }
        break;
        }
          
      case PUSH:
        {
        if( item.nonEmpty() )
          {
          cp.pushString = item.first().toString();
          cp.pushAmount = Duration.getDuration(cp.pushString);
        //System.out.println("pushAmount " + pushString + " = " + cp.pushAmount + " slots");
          }
        break;
        }
          
      default:
          cp.setError("Error in chord pattern " + original);
          return cp;
      }
    }
  //System.out.println("makeChordPattern on " + original + " returns " + cp);
  return cp;
  }


/**
 * Adds a rule and duration to this ChordPattern.
 * @param rule      a String containing the rule
 * @param duration  a String containing the duration
 */
private void addRule(String rule, String duration)
  {
    rules.add(rule);
    durations.add(duration);
  }


@Override
/**
 * Get the duration, in slots
 * @return 
 */
public int getDuration()
  {
    int duration = 0;
    
    Iterator<String> r = rules.iterator();
    Iterator<String> d = durations.iterator();
    
    while( r.hasNext() )
      {
        String rule = r.next();
        String dur = d.next();
        if( !rule.equals(VOLUME_STRING) )
          {
            // Ignore volume in computing duration
            duration += Duration.getDuration(dur);
          }
      }
    
    return duration;
  }

/**
 * Returns an ArrayList of exactly two chord patterns, splitting
 * up this pattern. But the second pattern will be null if empty.
 * @param desiredDuration
 * @return 
 */

public ArrayList<ChordPattern> splitChordPattern(int desiredDuration)
{
    //System.out.println("Splitting for desired " + desiredDuration + " " + this);
    ArrayList<ChordPattern> result = new ArrayList<>();
    ChordPattern prefix = new ChordPattern();
    ChordPattern suffix = new ChordPattern();
    Iterator<String> r = rules.iterator();
    Iterator<String> d = durations.iterator();
    
    String rule;
    String dur;
    int slots = 0;
    // copy first part of pattern to prefix
    
    int accumulatedDuration = 0;
    int difference = accumulatedDuration - desiredDuration;
    
    while( r.hasNext() && difference < 0 )
      {
        rule = r.next();
        dur = d.next();
        
        if( rule.equals(VOLUME_STRING) )
          {
            prefix.rules.add(rule);
            prefix.durations.add(dur);
          }
        else
          {
            slots =  Duration.getDuration(dur);
            accumulatedDuration += slots;
            difference = accumulatedDuration - desiredDuration;
            if( difference <= 0 )
              {
              prefix.rules.add(rule);
              prefix.durations.add(dur);
              }
            else
              {
              if( difference > 0 )
                {
                // split a single rule
                prefix.rules.add(rule);
                prefix.durations.add(Note.getDurationString(slots-difference));
                suffix.rules.add(rule);
                suffix.durations.add(Note.getDurationString(difference));           
                }
              }
          }
      }
 
    // copy remainder of pattern to suffix
    while( r.hasNext() )
      {
      rule = r.next();
      dur = d.next();
      suffix.rules.add(rule);
      suffix.durations.add(dur);                   
      }

    result.add(prefix);
    result.add(suffix);
    return result;
}

/**
 * Realizes the Pattern into a sequencable Polylist.
 * @param chord     the ChordSymbol to voice
 * @param lastChord a Polylist containing the last chord voicing
 * @return A Polylist that can be sequenced.  This Polylist has two elements.
 * 
 *         The first element is another Polylist that contains
 *         a sequence of chord voicings (each of which is a Polylist of
 *         NoteSymbols, including possibly volume settings.)  
 * 
 *         The second element is a MelodyPart containing
 *         containing rests, each of which is a duration corresponding to
 *         the voicings.
 */

public ChordPatternVoiced applyRules(ChordSymbol chord, Polylist lastChord, Style style)
  {
  Iterator<String> i = rules.iterator();
  Iterator<String> j = durations.iterator();
  
  lastChord = BassPattern.filterOutStrings(lastChord);

  //System.out.println("applyRules in: Chord = " + chord + " previous Voicing = " + lastChord + ", rules = " + rules + ", durations = " + durations);

  String chordRoot = chord.getRootString();
  ChordForm chordForm = chord.getChordForm();
  Key key = chordForm.getKey(chordRoot);
  int rise = PitchClass.findRise(chordRoot);

  // FIXME: this is sort of a hacky way to do the durations since we
  // don't really have a proper way to store music with multiple voices
  MelodyPart durationMelody = new MelodyPart();

  LinkedList<Polylist> chordLine = new LinkedList<Polylist>();
  
  int volume = 127;

  while( i.hasNext() )
    {
    String rule = i.next();
    String duration = j.next();

    //System.out.println("     rule = " + rule + ", duration = " + duration);
    // Process the symbols in the pattern into notes and rests,
    // inserting volume indication when the volume changes.
    
    if( rule.equals(STRIKE_STRING) )
    {
        durationMelody.addNote(new Rest(Duration.getDuration(duration)));
        //System.out.println("durationMelody = " + durationMelody);
        Polylist voicing = findVoicing(chord, lastChord, style);

        if( voicing == null )
          {
          voicing = Polylist.nil;
          //break;
          }
        //System.out.println("voicing = " + voicing);
        chordLine.add(voicing.cons(new VolumeSymbol(volume)));
        lastChord = voicing; 
    }
    
    else if( rule.equals(REST_STRING) )
    {
        durationMelody.addNote(new Rest(Duration.getDuration(duration)));
        chordLine.add(Polylist.nil); // was NoteSymbol.makeNoteSymbol("r" + duration));
    }
    
    else if( rule.equals(VOLUME_STRING) )
    {
        // Volume will take effect when next chord voicing is appended.
        volume = Integer.parseInt(duration);
    }
    
    else
      {
      // This is used for single notes in the chord pattern, 
      // such as in the "La Bomba" pattern:
      // (X 1 4) (X 3 8) (X 5 8) (X 3 4) (X 6 8) (X 5 8)
        int interval = Integer.parseInt(rule);
         
        durationMelody.addNote(new Rest(Duration.getDuration(duration)));
            
        // first, get the note that is the interval from the root
        Polylist scales = chordForm.getScales();
            
        Polylist scale = (Polylist) scales.first();
        NoteSymbol tonic = NoteSymbol.makeNoteSymbol( (String) scale.first() );
        String scaleType = Advisor.concatListWithSpaces(scale.rest());
        ScaleForm scaleForm = Advisor.getScale(scaleType);
            
        Polylist tones = scaleForm.getSpell(tonic);
        tones = NoteSymbol.transposeNoteSymbolList(tones, rise);

        tones = tones.reverse().rest().reverse();
        //System.out.println("The transposed notes are: " + tones);
            
        // with the note symbol, we can get the chord base, which will
        // be used for the chord
        NoteSymbol noteSymbol = BassPattern.getInterval(interval, tones);
        PitchClass pitchClass = noteSymbol.getPitchClass();
        String noteBass = pitchClass.getChordBase();
            
        String chordName = (String)noteBass.concat("Note");
        Chord newChord = new Chord(chordName);
            
        //System.out.println("The new chord is " + newChord);
            
        Polylist voicing = findVoicing(newChord.getChordSymbol(), lastChord, style);
            
        // then add the voicing of the chord to the chord line
        if( voicing == null )
        {
            voicing = Polylist.nil;
        }
            
        //System.out.println("The voicing for this chord is: " + voicing);
                        
        chordLine.add(voicing.cons(new VolumeSymbol(volume)));
        lastChord = voicing;
            
        //System.out.println("The duration melody is: " + durationMelody);
        //System.out.println("The chord line is: " + chordLine);
      }
    }

  ChordPatternVoiced result = new ChordPatternVoiced(chordLine, durationMelody);

  //System.out.println("applyRules: Chord = " + chord + ", rules = " + rules + ", durations = " + durations + ", result (chordline, durations) = " + result);
  return result;
  }


/**
 * Returns a boolean determining whether the given chord can be voiced
 * based on the given Style.
 * @param chord     the ChordSymbol to voice
 * @param style     the Style to use to voice the ChordSymbol
 * @return a boolean determining whether the given chord can be voiced
 *         based on the given Style
 */
public static boolean goodVoicing(ChordSymbol chord, Style style)
  {
  return goodVoicing(chord, style.getChordBase(), style);
  }


/**
 * Returns a boolean determining whether the given chord can be voiced
 * based on the given Style and a previous chord.
 * @param chord     the ChordSymbol to voice
 * @param lastChord a Polylist containing the last chord voicing
 * @param style     the Style to use to voice the ChordSymbol
 * @return a boolean determining whether the given chord can be voiced
 *         based on the given Style and a previous chord
 */
public static boolean goodVoicing(ChordSymbol chord, Polylist lastChord,
                                  Style style)
  {
  Polylist L = findVoicing(chord, lastChord, style, false);
  if( L == null )
    {
    return false;
    }
  else
    {
    return true;
    }
  }


/**
 * Returns a voicing for a chord.
 * @param chord     a ChordSymbol to voice
 * @param lastChord the previous chord voicing in the progression
 * @param style     the Style to voice the chord in
 * @return a Polylist containing the chord voicing
 */
public static Polylist findVoicing(ChordSymbol chord, Polylist lastChord,
                                   Style style)
  {
  //System.out.println("findVoicing " + chord + " " + lastChord + " " + style);
  return findVoicing(chord, lastChord, style, true);
  }


/**
 * Returns a voicing for a chord.
 * @param chord     a ChordSymbol to voice
 * @param lastChord the previous chord voicing in the progression
 * @param style     the Style to voice the chord in
 * @param verbose   a boolean deciding whether to show error messages
 * @return a Polylist containing the chord voicing
 */
public static Polylist findVoicing(ChordSymbol chord, Polylist lastChord,
                                   Style style, boolean verbose)
  {
  //System.out.println("findVoicing " + chord + " " + lastChord + " " + style + " " + verbose);
  Polylist voicing = findVoicingAndExtension(chord, lastChord, style, verbose);

  if( voicing == null )
    {
    return null;    // append the voicing and the extension
    }
  voicing = ((Polylist)voicing.first()).append(
          (Polylist)voicing.second());

  return voicing;
  }


/**
 * Returns A voicing for a chord, separating out the voicing and its 
 * extension.
 * @param chord     a ChordSymbol to voice
 * @param lastChord the previous chord voicing in the progression
 * @param style     the Style to voice the chord in
 * @param verbose   a boolean deciding whether to show error messages
 * @return a Polylist containing the chord voicing and its extension
 */
public static Polylist findVoicingAndExtension(ChordSymbol chord,
                                               Polylist lastChord, Style style,
                                               boolean verbose)
  {
  //System.out.println("findVoicingAndExtension " + chord + " " + lastChord + " " + style + " " + verbose);
  Polylist voicings = getVoicingAndExtensionList(chord, lastChord, style,
          verbose);
  if( voicings == null )
    {
    return null;
    }
  return (Polylist)BassPattern.getRandomItem(voicings);
  }


/**
 * Returns A voicing for a chord, separating out the voicing and its 
 * extension.
 * @param chord     a ChordSymbol to voice
 * @param lastChord the previous chord voicing in the progression
 * @param style     the Style to voice the chord in
 * @param verbose   a boolean deciding whether to show error messages
 * @return a Polylist containing the chord voicing and its extension
 */
public static Polylist findFirstVoicingAndExtension(ChordSymbol chord,
                                                    Polylist lastChord,
                                                    Style style, boolean verbose)
  {
  Polylist voicings = getVoicingAndExtensionList(chord, lastChord, style,
          verbose);
  if( voicings == null )
    {
    return null;
    }
  return (Polylist)voicings.first();
  }


static int[] lastVoicing=null;//needs to be static to improve voice leading.
/**
 * Returns a list of acceptable voicings for a chord, separating out the voicing and its 
 * extension.
 * @param chord     a ChordSymbol to voice
 * @param lastChord the previous chord voicing in the progression
 * @param style     the Style to voice the chord in
 * @param verbose   a boolean deciding whether to show error messages
 * @return a Polylist containing the chord voicing and its extension
 */
public static Polylist getVoicingAndExtensionList(ChordSymbol chord,
                                                  Polylist lastChord,
                                                  Style style, 
                                                  boolean verbose)
  {
  //System.out.println("getVoicingAndExtensionList " + chord + " " + lastChord + " " + style + " " + verbose);

    //Form Chord Voicing
    //Start
    //---------------------------------------------------------------------------------------------//
    
    /*Init Dan's Classes*/
    if(style.hasCustomVoicing()){

        VoicingGenerator vgen = style.getVoicingGenerator();
        HandManager handyMan = style.getHandManager();
        vgen.getHandSettings(handyMan);

        /*process values*/
        //while loop with first item
        
        //ArrayList<int[]>progressionVoicings = new ArrayList<int[]>();
        //ArrayList<Integer> bassList = new ArrayList<Integer>();

        VoicingDebug.println("----------");
        VoicingDebug.println("chord: "+chord.toString());    //trace
        Chord chord1 = new Chord(chord.getName());
        Polylist spelling;                             //create voicing variable for first chord
        spelling = chord1.getSpell();                  //get chord1 voicing; assign to voicing
        VoicingDebug.println("spelling: " + spelling.toString());    //trace
        //bassList.add(((NoteSymbol)spelling.first()).getMIDI()); //gets a list of bass notes
        Polylist priorityPoly=chord1.getPriority();     //create a polylist for chord priority notes
        Polylist colorPoly=chord1.getColor();           //create a polylist for chord color notes
        int[] color=new int[colorPoly.length()];        //array for color notes' midi values
        int [] priority = new int[priorityPoly.length()];   //array for priority notes' midi values
        for(int i=0; i<color.length; i++)               //for loop that gets midi value of corresponding color note in colorPoly and puts in color[]
        {
            color[i]=((NoteSymbol)colorPoly.nth(i)).getMIDI();
            //System.out.println("color num:" +color[i]);
        }

        for(int i=0; i<priority.length; i++)            //for loop that gets midi value of corresponding priority note in priorityPoly and puts in priority[]
        {
            priority[i]=((NoteSymbol)priorityPoly.nth(i)).getMIDI();
            //System.out.println("priority num:" +priority[i]);
        }
        VoicingDebug.println("");
        VoicingDebug.println("New voicing:");

        handyMan.repositionHands();

        // revisit
        vgen.setColor(color);
        vgen.setPriority(priority);
        vgen.setRoot(chord1.getRootSemitones());
        
        vgen.getHandSettings(handyMan);

        int index=0;
        if(lastVoicing!=null){
            for(Polylist a = lastChord; a.nonEmpty(); a=a.rest()){
            lastVoicing[index] = ((NoteSymbol)a.first()).getMIDI();
            index++;
            VoicingDebug.println("last voicing "+Arrays.toString(lastVoicing));
            }
        }

        vgen.setPreviousVoicing(lastVoicing);
        vgen.calculate();
        int[] chordArray=vgen.getChord();
        //User Doesn't need to see this, comment out next line if desired
        if(lastVoicing!=null)
            VoicingDebug.println("Custom Voicing Analytics:,,,,NumNotesOld,"+lastVoicing.length+",NumNotesNew,"+chordArray.length+" ,Distance,"+VoicingDistanceCalculator.calculateDistance(lastVoicing,chordArray)+", NotesChanged,"+VoicingDistanceCalculator.calculateNotesChanged(lastVoicing,chordArray));
        lastVoicing = vgen.getChord();
        //progressionVoicings.add(lastVoicing);
        Polylist midiL;


        Integer[] lastVoicingObj=new Integer[lastVoicing.length];
        for(int i=0; i<lastVoicing.length; i++)
            lastVoicingObj[i] = lastVoicing[i];
        midiL=Polylist.PolylistFromArray(lastVoicingObj);       //creates polylist from lastVoicingObj to assign to a midi value list midiL
        VoicingDebug.println("midiL: "+midiL.toString());   //trace

        PolylistBuffer buffer = new PolylistBuffer();
        for( Polylist M = midiL; M.nonEmpty(); M = M.rest() )
        {
            NoteSymbol n = NoteSymbol.makeNoteSymbol(new Note((Integer)M.first()));
            buffer.append(n);
        }

        Polylist customVoicing = buffer.toPolylist();
        //chord.setVoicing(buffer.toPolylist());
        VoicingDebug.println("Voicing: " + customVoicing);
        VoicingDebug.println("----------");
        VoicingDebug.println("");
        
        // Return a list of a single voicing with an empty extension
        
        Polylist extension = Polylist.nil;
        return Polylist.list(Polylist.list(customVoicing, extension));
    }
/*End*/
//----------------------------------------------------------------------------------------------------//
    
  Polylist voicing = chord.getVoicing();
  String chordRoot = chord.getRootString();
  ChordForm chordForm = chord.getChordForm();
  Key key = chordForm.getKey(chordRoot);
  int rise = PitchClass.findRise(chordRoot);
  //System.out.println("getVoicingsAndExtensionList " + chord + " style = " + style + " getVoicing() = " + voicing);

  if( voicing.nonEmpty() )
    {
    // if the voicing is already specified in the chord, then
    // put the voicing and extension near the previous chord
    
    Polylist extension = chord.getExtension();
    int lowestNote=128;
    int highestNote=0;
            for(Object o:voicing.array())
            {
                
                if(((NoteSymbol)o).getMIDI()<lowestNote)
                    lowestNote=((NoteSymbol)o).getMIDI();
                if(((NoteSymbol)o).getMIDI()>highestNote)
                    highestNote=((NoteSymbol)o).getMIDI();
        
    
            }
            
    Polylist v = ChordPattern.placeVoicing(lastChord, voicing, extension,
           NoteSymbol.makeNoteSymbol(new Note(lowestNote)), NoteSymbol.makeNoteSymbol(new Note(highestNote)));
    //v=voicing;// fix here
    
    //System.out.println("Chord low, high"+style.getChordLow()+" , "+style.getChordHigh());
    if( v == null )
      {
      // if the specified voicing doesn't fit in range, error
      // and don't voice this chord
          
          if( verbose )
        {
        ErrorLog.log(ErrorLog.WARNING,
                "Voicing does not fit within range: " + voicing);
        }
      return null;
          
          //return Polylist.list(v);
      }
    else
      {
      return Polylist.list(v);
      }
        //return Polylist.list(v);
    }
  else
    {
    // if there is no voicing specified, then find one!
    // get the voicings from the vocabulary file for this chord type
    
    Polylist voicings = chordForm.getVoicings(chordRoot, key,
            style.getVoicingType());
    //System.out.println("chord = " + chord + ", voicings = " + voicings);
    // pick out the good voicings based on the previous chord and
    // the range
    
    voicings = chooseVoicings(lastChord, voicings,
            style.getChordLow(), style.getChordHigh());
    //System.out.println("chord = " + chord + ", voicings after choosing = " + voicings);

    // if none of the specified voicings fit in the range
    // or no voicings are specified, then generate voicings
    if( voicings.isEmpty() )
      {
      voicings = chordForm.generateVoicings(chordRoot, key);

      if( voicings.isEmpty() )
        {
        return null;
        }

      Polylist preferredVoicings = chooseVoicings(lastChord, voicings,
              style.getChordLow(), style.getChordHigh());

      if( preferredVoicings.nonEmpty() )
        {
        voicings = preferredVoicings;
        }

      // if there still is no good voicing, print out an error and return null
      if( voicings.isEmpty() )
        {
        if( verbose )
          {
          ErrorLog.log(ErrorLog.SEVERE,
                  "Range too small to voice chord: " + chord);
          }
        return null;
        }
      }
    return voicings;
    }
  }


/**
 * Choose appropriate voicings from a list of voicings.
 * @param lastChord a Polylist containing the last chord voicing
 * @param voicings  a Polylist containing voicings to choose from
 * @param lowNote   a NoteSymbol determining the lower end of the range
 * @param highNote  a NoteSymbol determining the high end of the range
 * @return a Polylist of appropriate voicings
 */
public static Polylist chooseVoicings(Polylist lastChord, Polylist voicings,
                                      NoteSymbol lowNote, NoteSymbol highNote)
  {
  PolylistBuffer goodVoicings = new PolylistBuffer();

  int smallestAverageLeap = 127;

  for( PolylistEnum venum = voicings.elements(); venum.hasMoreElements();)
    {
    Polylist voicing = (Polylist)venum.nextElement();
    
    //System.out.println("in chooseVoicings " + voicing + ", lastChord = " + lastChord);
    Polylist v = (Polylist)voicing.first();
    Polylist e = (Polylist)voicing.second();

    // put the voicing near the previous chord and within range
    Polylist L = placeVoicing(lastChord, v, e, lowNote, highNote);

    // if the voicing can't be placed, it is bad, so we just continue 
    if( L == null )
      {
      continue;
      }

    v = (Polylist)L.first();
    e = (Polylist)L.second();

    // find the averageLeap between the last chord and this
    // voicing plus its extension

    int leap = averageLeap(v.append(e), lastChord);

    /*
    leap += averageLeap(lastChord,v.append(e));
    leap /= 2;
     */

    if( leap < smallestAverageLeap )
      {
      smallestAverageLeap = leap;
      goodVoicings.append(Polylist.list(v, e));
      }
    else if( leap == smallestAverageLeap )
      {
      goodVoicings.append(Polylist.list(v, e));
      }
    }
  return goodVoicings.toPolylist();
  }


/**
 * Takes a voicing and places it just above another voicing.
 * @param lastChord a Polylist containing previous voicing
 * @param voicing   a Polylist containing the voicing to place
 * @return a Polylist containing the placed voicing
 */
 public static Polylist placeVoicingAbove(Polylist lastChord,
                                         Polylist voicing)
  {
  NoteSymbol lastNote = (NoteSymbol)lastChord.first();
  NoteSymbol voicingNote = (NoteSymbol)voicing.first();

  int difference = lastNote.getMIDI() - voicingNote.getMIDI();

  Polylist newVoicing;
  if( difference > 0 )
    {
    int octaves = (difference / 12) + 1;
    newVoicing = NoteSymbol.transposeNoteSymbolList(voicing, 12 * octaves);
    }
  else if( difference <= -12 )
    {
    int octaves = difference / 12;
    newVoicing = NoteSymbol.transposeNoteSymbolList(voicing, 12 * octaves);
    }
  else
    {
    newVoicing = voicing;
    }
  return newVoicing;
  }


/**
 * Takes a voicing and places it just below another voicing.
 * @param lastChord a Polylist containing previous voicing
 * @param voicing   a Polylist containing the voicing to place
 * @return a Polylist containing the placed voicing
 */
public static Polylist placeVoicingBelow(Polylist lastChord,
                                         Polylist voicing)
  {
  NoteSymbol lastNote = (NoteSymbol)lastChord.first();
  NoteSymbol voicingNote = (NoteSymbol)voicing.first();

  int difference = lastNote.getMIDI() - voicingNote.getMIDI();

  Polylist newVoicing;
  
  if( difference < 0 )
    {
    int octaves = (difference / 12) - 1;
    newVoicing = NoteSymbol.transposeNoteSymbolList(voicing, 12 * octaves);
    }
  else if( difference >= 12 )
    {
    int octaves = difference / 12;
    newVoicing = NoteSymbol.transposeNoteSymbolList(voicing, 12 * octaves);
    }
  else
    {
    newVoicing = voicing;
    }
  return newVoicing;
  }


/**
 * Takes a voicing and places it near another voicing.
 * @param lastChord a Polylist containing previous voicing
 * @param voicing   a Polylist containing the voicing to place
 * @param extension a Polylist containing a voicing extension
 * @param low       a NoteSymbol determining the low end of the range
 * @param high      a NoteSymbol determining the high end of the range
 * @return a Polylist containing the placed voicing and its extension
 */
public static Polylist placeVoicing(Polylist lastChord, Polylist voicing,
                                    Polylist extension,
                                    NoteSymbol low, NoteSymbol high)
  {
  //System.out.println("placeVoicing " + lastChord + " " + voicing + " " + extension + " " + low + " " + high);
  NoteSymbol oldNote = (NoteSymbol)voicing.first();
  voicing = placeVoicing(lastChord, voicing, low, high);
  if( voicing == null )
    {
    return null;
    }
  NoteSymbol newNote = (NoteSymbol)voicing.first();
  int diff = newNote.getMIDI() - oldNote.getMIDI();
  extension = NoteSymbol.transposeNoteSymbolList(extension, diff);
  return Polylist.list(voicing, extension);
  }


/**
 * Takes a voicing and places it near another voicing.
 * @param lastChord a Polylist containing previous voicing
 * @param voicing   a Polylist containing the voicing to place
 * @param low       a NoteSymbol determining the low end of the range
 * @param high      a NoteSymbol determining the high end of the range
 * @return a Polylist containing the placed voicing
 */
public static Polylist placeVoicing(Polylist lastChord, Polylist voicing,
                                    NoteSymbol low, NoteSymbol high)
  {
  //System.out.println("placeVoicing " + lastChord + " " + voicing + " " + low + " " + high);
  if( lastChord.isEmpty() )
    {
    lastChord = Polylist.list(low, high); // rk 8/6/07
    }

  NoteSymbol lastNote = (NoteSymbol)lastChord.first();
  NoteSymbol voicingNote = (NoteSymbol)voicing.first();

  int semitones = lastNote.getSemitonesAbove(voicingNote);
  Polylist v;

  if( semitones >= 6 )
    {
    v = placeVoicingBelow(lastChord, voicing);
    }
  else
    {
    v = placeVoicingAbove(lastChord, voicing);
    }
  NoteSymbol lowest = NoteSymbol.getLowest(v);
  NoteSymbol highest = NoteSymbol.getHighest(v);

  while( lowest.getMIDI() < low.getMIDI() )
    {
    v = NoteSymbol.transposeNoteSymbolList(v, 12);
    lowest = NoteSymbol.getLowest(v);
    highest = NoteSymbol.getHighest(v);
    if( highest.getMIDI() > high.getMIDI() )
      {
      return null;
      }
    }

  while( highest.getMIDI() > high.getMIDI() )
    {
    v = NoteSymbol.transposeNoteSymbolList(v, -12);
    lowest = NoteSymbol.getLowest(v);
    highest = NoteSymbol.getHighest(v);
    if( lowest.getMIDI() < low.getMIDI() )
      {
      return null;
      }
    }

  return v;
  }


/**
 * Takes two chord voicings and calculates the "average leap" 
 * between the two.
 * The "average leap" is the average "smallest leap" between individual
 * notes in chord2 and all of chord1.
 * @param chord1     a Polylist of a chord to compare
 * @param chord2     a Polylist of a chord to compare
 * @return the "average leap" between the two chords
 * @see #smallestLeap(Polylist,NoteSymbol)
 */
public static int averageLeap(Polylist chord1, Polylist chord2)
  {
  int sum = 0;
  int num = chord2.length();
  
  while( chord2.nonEmpty() ) //( int i = 0; i < chord2.length(); i++ )
    {
    NoteSymbol note = (NoteSymbol)chord2.first();
    int leap = smallestLeap(chord1, note);
    sum += leap;
    chord2 = chord2.rest();
    }

  return (int)((double)sum / num);
  }


/**
 * Takes a chord and a note and computes the smallest leap from
 * the note to a note in the chord.
 * @param chord     a Polylist containing the chord to compare
 * @param note      a NoteSymbol of the note to compare
 */
public static int smallestLeap(Polylist chord, NoteSymbol note)
  {
  int noteMIDI = note.getMIDI();
  int smallestLeap = 127;
  while( chord.nonEmpty() )
    {
    NoteSymbol chordNote = (NoteSymbol)chord.first();
    int leap = Math.abs(chordNote.getMIDI() - noteMIDI);
    if( leap < smallestLeap )
      {
      smallestLeap = leap;
      }
    chord = chord.rest();
    }

  return smallestLeap;
  }

//Added summer2007 for use with Style GUI
public String forGenerator()
  {
  StringBuilder rule = new StringBuilder();
  
  for( int i = 0; i < durations.size(); i++ )
    {
        if( rules.get(i).equals(STRIKE_STRING) || rules.get(i).equals(REST_STRING) || rules.get(i).equals(VOLUME_STRING) )
        {
            String nextNote = rules.get(i);
            rule.append(nextNote);
            rule.append(durations.get(i));
            rule.append(" "); 
        }
        else
        {
            String nextNote = rules.get(i);
            rule.append("(X ");
            rule.append(nextNote);
            rule.append(" ");
            rule.append(durations.get(i));
            rule.append(") ");
        }
    }
  return rule.toString();
  }


/**
 * Get the "push" amount for this pattern, in slots
 */

public int getPushAmount()
  {
    return pushAmount;
  }


public String getPushString()
  {
    return pushString;
  }

@Override
public String toString()
  {
    return "ChordPattern: " + rules + " " + durations;
  }

public String getName()
    {
    return patternName;
    }

public LinkedHashMap getDefinedRules()
{
    return definedRules;
}

public void setDefinedRules(LinkedHashMap map)
{
    if( map.isEmpty() )
    {
        return;
    }
    else
    {
        definedRules = map;
    //System.out.println("chord defined rules " + getDefinedRules());
    }
}

}

```

### File: src\imp\style\stylePatterns\ChordPatternElement.java

```java

/*
 * This Java Class is part of the Impro-Visor Application
 *
 * Copyright (C) 2005-2012 Robert Keller and Harvey Mudd College
 *
 * Impro-Visor is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * Impro-Visor is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * merchantability or fitness for a particular purpose.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Impro-Visor; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 */
package imp.style.stylePatterns;

import imp.data.Duration;
import imp.data.Note;
import imp.util.ErrorLog;
import polya.Polylist;

/**
 *
 * @author Carli Lessard
 */
public class ChordPatternElement {

    public enum ChordNoteType
    {
    CHORD, PITCH, VOLUME, REST, UNKNOWN
    }

    ChordNoteType noteType = ChordNoteType.CHORD;

    int degree = 1;

    String durationString;

    public ChordPatternElement getCopy()
    {
	return new ChordPatternElement(noteType, degree, durationString);
    }

    public ChordPatternElement(String durationString)
    {
	this(ChordNoteType.CHORD, durationString);
    }

    public ChordPatternElement(ChordNoteType noteType, String durationString)
    {
	this.noteType = noteType;
	this.durationString = durationString;
    }

    public ChordPatternElement(ChordNoteType noteType, int degree, String durationString)
    {
	this.noteType = noteType;
	this.degree = degree;
	this.durationString = durationString;
    }

    public ChordNoteType getNoteType()
    {
	return noteType;
    }

    public void setNoteType(ChordNoteType noteType)
    {
    	this.noteType = noteType;
    }

    public int getDegree()
    {
	return degree;
    }

    public void setDegree(int degree)
    {
	this.degree = degree;
    }

    public int getSlots()
    {
	return Duration.getDuration(durationString);
    }

    public void setDuration(int slots)
    {
	durationString = Note.getDurationString(slots);
    }

    public static ChordPatternElement makeChordPatternElement(Object ob) 
    {
	if( ob instanceof String )
	{
		String stringOb = (String) ob;
		
		if( stringOb.equals("") )
		{
			return null;
		}
		
		String durationString = stringOb.substring(1);

		if( stringOb.startsWith("V") )
		{
			return new ChordPatternElement(ChordNoteType.VOLUME, durationString);
		}

		ChordNoteType noteType = getChordNoteType(stringOb.charAt(0));

		if( noteType == ChordNoteType.UNKNOWN )
		{
			ErrorLog.log(ErrorLog.WARNING, "Unknown chord note type: " + stringOb);
			return null;
		}
		
		if( durationString.equals("") )
		{
			ErrorLog.log(ErrorLog.WARNING, "Chord pattern element has no duration: " + stringOb);
			return null;
		}
		
		else
		{
			int duration = Duration.getDuration(durationString);

			if( duration == 0 )
			{
				ErrorLog.log(ErrorLog.WARNING, "Chord pattern ele,ent has 0 duration: " + stringOb);
				return null;
			}

			else
			{
				return new ChordPatternElement(noteType, durationString);
			}
		}
	}

	else if( ob instanceof Polylist )
	{
		Polylist listOb = (Polylist) ob;
		int len = listOb.length();
		if( len == 3 )
		{
			if( listOb.first().equals("X") )
			{
				Object second = listOb.second();

				int degreeValue = 1;

				if( second instanceof Long )
				{
					degreeValue = ((Long) listOb.second()).intValue();

					if( degreeValue < 1 || degreeValue > 11 || degreeValue == 8 || degreeValue == 10 )
					{
						ErrorLog.log(ErrorLog.WARNING, "Scale degree out of range in chord note: " + ob);
						return null;
					}
				}
				
				String durationString = "";
			
				Object third = listOb.third();

				if( third instanceof Long || third instanceof String )
				{
					durationString = "" + third;

					int duration = Duration.getDuration(durationString);

					if ( duration == 0 )
					{
						ErrorLog.log(ErrorLog.WARNING, "Chord pattern element has 0 duration: " + ob);
						return null;
					}
				}

				return new ChordPatternElement(ChordNoteType.PITCH, degreeValue, durationString);

			}
		}
	}
	ErrorLog.log(ErrorLog.WARNING, "Unrecognized chord note: " + ob);
	return null;
    }

public static ChordNoteType getChordNoteType(char c)
{
	switch( c )
	{
		case 'X':
		case 'x':
			return ChordNoteType.CHORD;

		case 'R':
		case 'r':
			return ChordNoteType.REST;

		case 'V':
		case 'v': 
			return ChordNoteType.VOLUME;

		default:	
			return ChordNoteType.UNKNOWN;
	}
}

public String getDurationString()
{
	return durationString;
}

public String getDegreeString()
{
	return "" + getDegree();
}

public Object getText()
{
	switch( noteType )
	{
		default:
		case CHORD:
			return "X" + getDurationString();

		case PITCH:
			return Polylist.list("X", getDegreeString(), getDurationString());
	}
}

public boolean nonRest()
{
	return noteType != ChordNoteType.REST;
}
    
}

```

### File: src\imp\style\stylePatterns\BassPattern.java

```java

/**
 * This Java Class is part of the Impro-Visor Application
 *
 * Copyright (C) 2005-2018 Robert Keller and Harvey Mudd College
 *
 * Impro-Visor is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * Impro-Visor is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * merchantability or fitness for a particular purpose.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Impro-Visor; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 */

package imp.style.stylePatterns;

import imp.data.advice.ScaleForm;
import imp.data.advice.Advisor;
import imp.Constants;
import imp.data.ChordForm;
import imp.data.ChordSymbol;
import imp.data.Duration;
import imp.data.Key;
import imp.data.Leadsheet;
import imp.data.MelodySymbol;
import imp.data.NoteSymbol;
import imp.data.PitchClass;
import imp.style.Style;
import imp.data.VolumeSymbol;
import imp.util.ErrorLog;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedList;
import java.util.Random;
import java.util.LinkedHashMap;
import polya.Polylist;
import polya.PolylistBuffer;

/**
 * Contains a rhythmic pattern for use in a bassline and methods needed to
 * realize that bassline according to the rules of the pattern.
 * @see Style
 * @author Stephen Jones, Stephen Lee, Robert Keller
 */

public class BassPattern
        extends Pattern
        implements Constants, Serializable
  {
  /**
   * the random number generator for getRandomItem
   */
  private static Random gen = new Random();

  /**
   * the rules for the pattern, stored as indices into the ruleTypes array
   */
  private ArrayList<Integer> rules;

  /**
   * the durations for the pattern, stored as leadsheet representation of
   * rhythm
   */
  private ArrayList<String> durations;

  /**
   * the modifiers for the pattern, e.g. U, D
   */

  private ArrayList<String> modifiers;
  
  /**
   * the rules defined in the style
   */
  private LinkedHashMap<String, Polylist> definedRules;

  /**
   * array containing the types of rules
   */
  private static String ruleTypes[] = {"X", "1", "2", "3", "4", "5", "6", "7",
                                       "8", "9", "10",
                                       "B", "C", "S", "A", "N", "R", "=", "U",
                                       "D", "V"};

  /**
   * indices into the ruleTypes array
   */
  private static final int PITCH    = 0;

  private static final int BASS     = 11;

  private static final int CHORD    = 12;

  private static final int SCALE    = 13;

  private static final int APPROACH = 14;

  private static final int NEXT     = 15;

  private static final int REST     = 16;

  private static final int EQUAL    = 17;

  private static final int UP       = 18;

  private static final int DOWN     = 19;

  private static final int VOLUME   = 20;



// These are added onto the above rule values to piggy-back accidentals

  private static final int FLATTEN = 100;
  private static final int SHARPEN = 200;

  private static final String FLAT_STRING = "b";
  private static final String SHARP_STRING = "#";

  // Strings for the up/down addition to style editor syntax
  private static final String NOTEPLUS = "U";
  private static final String NOTEMINUS = "D";

  // indicators for the up/down addition to style editor syntax
  private static final int STAY = 0;


  /**
   * If note skip is this interval or beyond, consider it "not near"
   */
  private static final int BIG_RISE = 6;

  /**
   * Allow internal bass to exceed limits by this amount.
   */
  private static final int MARGIN = 11;

  private static final int SOFTMARGIN = 6;


 /**
   * array containing BassPattern keywords
   */
  private static String keyword[] = {"rules", "weight", "name", "use"};

  // indices into the keyword array
  private static final int RULES = 0;

  private static final int WEIGHT = 1;
  
  private static final int NAME = 2;
  
  private static final int USE = 3;
  
  private String patternName = "";
  
  /**
   * Creates a new BassPatern (only used by the factory).
   */
  public BassPattern()
    {
    rules = new ArrayList<Integer>();
    durations = new ArrayList<String>();
    modifiers = new ArrayList<String>();
    }

  /**
   * A factory for creating a BassPattern from a Polylist
   * @param L         a Polylist containing BassPattern information
   * @return the BassPattern created from the Polylist, or null if there
   *         was a problem
   */
  public static BassPattern makeBassPattern(Polylist L)
    {
//System.out.println("makeBassPattern " + L);
    Polylist original = L;
    BassPattern bp = new BassPattern();
    // Example pattern:
    //
    //         (bass-pattern (rules B4+8 (X 5 4) B4 A8) (weight 10))
    //
    while( L.nonEmpty() )
      {
      Object segment = L.first();
//System.out.println("segment = " + segment);
      L = L.rest();
      if( segment instanceof Polylist && ((Polylist)segment).nonEmpty() ) // e.g. (rules B4+8 (X 5 4) B4 A8)
        {
        Polylist item = (Polylist)segment;

        if( item.nonEmpty() && item.first() instanceof String )
          {
          String dispatcher = (String)item.first(); // e.g. rules or weight
          item = item.rest();                       // e.g. (B4+8 (X 5 4) B4 A8)

          switch( Leadsheet.lookup(dispatcher, keyword) )
            {
            case NAME:
              {
                  if(item == null || item.isEmpty() || item.first().equals("")) 
                  {
                    break; 
                  }
                  else if(item.first() instanceof String)
                  {
                    bp.patternName = (String) item.first();
                  }
                  else
                  {
                    bp.setError("Unrecognized name type in bass pattern: " + item.first());
                    return bp;
                  }
                  break;
              }
            case RULES:
              while( item.nonEmpty() )
                {
                Object entry = item.first(); // e.g. B4+8
//System.out.println("\nraw rule = " + entry);
                item = item.rest();          // e.g. ((X 5 4) B4 A8)
                if( entry instanceof Polylist )
                  {
                  // e.g. (X 5 4)
                  Polylist plist = (Polylist)entry;
                  int len = plist.length();
                  if( len >= 3 && plist.first().equals(ruleTypes[PITCH]) )
                    {
                    String rule = plist.second().toString();
                    String duration = plist.third().toString();
                    String modifier = "";
                    if( len == 4 )
                    {
                        // optional modifier
                    modifier = plist.fourth().toString();
                    }
                    bp.addRule(rule, duration, modifier);
                    }
                  else
                    {
                    bp.setError("unrecognized " + segment + " in bass pattern: " + original);
                    return bp;
                    }
                  }
                else if( entry instanceof String )
                  {
                  String rule = (String)entry;
                  
                  if( rule.equals(NOTEPLUS) || rule.equals(NOTEMINUS) )
                    {
                    //System.out.println("entry is " + (String)entry);
                    bp.addRule(rule, "");
                    }
                  
                  else
                   {
                  // e.g. B4+8 or A8
                  String duration = rule.substring(1);
                  rule = rule.substring(0, 1);
                  char c = rule.charAt(0);
                  switch( c )
                    {
                      case 'A':
                      case 'B':
                      case 'C':
                      case 'N':
                      case 'R':
                      case 'S':
                      case 'V':
                      case 'X':
                      case '=':
                          bp.addRule(rule, duration);
                          break;
                          
                      default:
                          bp.setError("unrecognized " + rule + " in bass pattern: " + original);
                          return bp;
                     }
                   }
                  }
                else
                  {
                  bp.setError("unrecognized " + entry + " in bass pattern: " + original);
                  return bp;
                  }
                }
              break;

            case WEIGHT:
              Number w = (Number)item.first();
              bp.setWeight(w.floatValue());
              break;

            default:
              bp.setError("unrecognized " + dispatcher + " in bass pattern: " + original);
              return bp;
            }
          }
        else
          {
          bp.setError("unrecognized " + segment + " in bass pattern: " + original);
          return bp;
          }
        }
      else
        {
        bp.setError("unrecognized " + segment + " in bass pattern: " + original);
        return bp;
        }
      }

    return bp;
    }

  /**
   * A method that adds rules and durations to an existing bass pattern
   * Used in place of makeBassPattern when the Style has pre-defined rules
   * @param L
   * @return 
   */
    public BassPattern makePattern(Polylist L)
    {
//System.out.println("makeBassPattern " + L);
    Polylist original = L;
    BassPattern bp = this;
    // Example pattern:
    //
    //         (bass-pattern (rules B4+8 (X 5 4) B4 A8) (weight 10))
    //
    while( L.nonEmpty() )
      {
      Object segment = L.first();
//System.out.println("segment = " + segment);
      L = L.rest();
      if( segment instanceof Polylist && ((Polylist)segment).nonEmpty() ) // e.g. (rules B4+8 (X 5 4) B4 A8)
        {
        Polylist item = (Polylist)segment;

        if( item.nonEmpty() && item.first() instanceof String )
          {
          String dispatcher = (String)item.first(); // e.g. rules or weight
          item = item.rest();                       // e.g. (B4+8 (X 5 4) B4 A8)

          switch( Leadsheet.lookup(dispatcher, keyword) )
            {
            case NAME:
              {
                  if(item == null || item.isEmpty() || item.first().equals("")) 
                  {
                    break; 
                  }
                  else if(item.first() instanceof String)
                  {
                    bp.patternName = (String) item.first();
                  }
                  else
                  {
                    bp.setError("Unrecognized name type in bass pattern: " + item.first());
                    return bp;
                  }
                  break;
              }
                
            case USE:
            {
                if( item.first() instanceof String )
                {
                    String name = (String) item.first();
                    bp.patternName = name;
                    LinkedHashMap ruleDefinitions = bp.getDefinedRules();
                    Polylist rules = (Polylist)ruleDefinitions.get( name );
                    String first = (String)rules.first();
                    if( Leadsheet.lookup(first, keyword) == RULES )
                    {
                        rules = rules.rest();
                        while( rules.nonEmpty() )
                {
                Object entry = rules.first(); // e.g. B4+8
//System.out.println("\nraw rule = " + entry);
                rules = rules.rest();          // e.g. ((X 5 4) B4 A8)
                if( entry instanceof Polylist )
                  {
                  // e.g. (X 5 4)
                  Polylist plist = (Polylist)entry;
                  int len = plist.length();
                  if( len >= 3 && plist.first().equals(ruleTypes[PITCH]) )
                    {
                    String rule = plist.second().toString();
                    String duration = plist.third().toString();
                    String modifier = "";
                    if( len == 4 )
                    {
                        // optional modifier
                    modifier = plist.fourth().toString();
                    }
                    bp.addRule(rule, duration, modifier);
                    }
                  else
                    {
                    bp.setError("unrecognized " + segment + " in bass pattern: " + original);
                    return bp;
                    }
                  }
                else if( entry instanceof String )
                  {
                  String rule = (String)entry;
                  
                  if( rule.equals(NOTEPLUS) || rule.equals(NOTEMINUS) )
                    {
                    //System.out.println("entry is " + (String)entry);
                    bp.addRule(rule, "");
                    }
                  
                  else
                   {
                  // e.g. B4+8 or A8
                  String duration = rule.substring(1);
                  rule = rule.substring(0, 1);
                  char c = rule.charAt(0);
                  switch( c )
                    {
                      case 'A':
                      case 'B':
                      case 'C':
                      case 'N':
                      case 'R':
                      case 'S':
                      case 'V':
                      case 'X':
                      case '=':
                          bp.addRule(rule, duration);
                          break;
                          
                      default:
                          bp.setError("unrecognized " + rule + " in bass pattern: " + original);
                          return bp;
                     }
                   }
                  }
                else
                  {
                  bp.setError("unrecognized " + entry + " in bass pattern: " + original);
                  return bp;
                  }
                }
                    }
                }
                else
                {
                    bp.setError("unrecognized identifier for a defined pattern: "
                            + item.first());
                    return bp;
                }
                break;
            }
            
            case RULES:
              while( item.nonEmpty() )
                {
                Object entry = item.first(); // e.g. B4+8
//System.out.println("\nraw rule = " + entry);
                item = item.rest();          // e.g. ((X 5 4) B4 A8)
                if( entry instanceof Polylist )
                  {
                  // e.g. (X 5 4)
                  Polylist plist = (Polylist)entry;
                  int len = plist.length();
                  if( len >= 3 && plist.first().equals(ruleTypes[PITCH]) )
                    {
                    String rule = plist.second().toString();
                    String duration = plist.third().toString();
                    String modifier = "";
                    if( len == 4 )
                    {
                        // optional modifier
                    modifier = plist.fourth().toString();
                    }
                    bp.addRule(rule, duration, modifier);
                    }
                  else
                    {
                    bp.setError("unrecognized " + segment + " in bass pattern: " + original);
                    return bp;
                    }
                  }
                else if( entry instanceof String )
                  {
                  String rule = (String)entry;
                  
                  if( rule.equals(NOTEPLUS) || rule.equals(NOTEMINUS) )
                    {
                    //System.out.println("entry is " + (String)entry);
                    bp.addRule(rule, "");
                    }
                  
                  else
                   {
                  // e.g. B4+8 or A8
                  String duration = rule.substring(1);
                  rule = rule.substring(0, 1);
                  char c = rule.charAt(0);
                  switch( c )
                    {
                      case 'A':
                      case 'B':
                      case 'C':
                      case 'N':
                      case 'R':
                      case 'S':
                      case 'V':
                      case 'X':
                      case '=':
                          bp.addRule(rule, duration);
                          break;
                          
                      default:
                          bp.setError("unrecognized " + rule + " in bass pattern: " + original);
                          return bp;
                     }
                   }
                  }
                else
                  {
                  bp.setError("unrecognized " + entry + " in bass pattern: " + original);
                  return bp;
                  }
                }
              break;

            case WEIGHT:
              Number w = (Number)item.first();
              bp.setWeight(w.floatValue());
              break;

            default:
              bp.setError("unrecognized " + dispatcher + " in bass pattern: " + original);
              return bp;
            }
          }
        else
          {
          bp.setError("unrecognized " + segment + " in bass pattern: " + original);
          return bp;
          }
        }
      else
        {
        bp.setError("unrecognized " + segment + " in bass pattern: " + original);
        return bp;
        }
      }

    return bp;
    }

  /**
   * Adds a rule and duration to this BassPattern.
   * @param rule      a String containing the rule
   * @param duration  a String containing the duration
   */
  private void addRule(String rule, String durationString)
  {
      addRule(rule, durationString, "");
  }

      /**
   * Adds a rule and duration to this BassPattern.
   * @param rule      a String containing the rule
   * @param duration  a String containing the duration
   */
  private void addRule(String rule, String durationString, String modifier)
    {
//System.out.println("\naddRule: rule = " + rule + ", duration = " + durationString + ", modifier = " + modifier);
    if( rule.length() == 2 )       // e.g. b5, #4
      {                             // get the rule, alter it
       String prefix = rule.substring(0,1);
       rule = rule.substring(1);
       if( FLAT_STRING.equals(prefix) )
       {
            int Number = Leadsheet.lookup(rule, ruleTypes) + FLATTEN;
            rules.add(Number);
       }
       else if( SHARP_STRING.equals(prefix) )
       {
            int Number = Leadsheet.lookup(rule, ruleTypes) + SHARPEN;
            rules.add(Number);
       }
       else
       {
        ErrorLog.log(ErrorLog.WARNING,
            "Unknown bass rule: " +  prefix + rule, false);
        return;
       }
    }
    else
    {
      rules.add(Leadsheet.lookup(rule, ruleTypes));
    }
    durations.add(durationString);
    modifiers.add(modifier);
//System.out.println("after addRule: rules = " + rules + ", durations = " + durations);
    }

  /**
   * Get duration in slots.
   * @return 
   */
  @Override
  public int getDuration()
    {
    int duration = 0;
    int n = durations.size();
    for( int i = 0; i < n; i++ )
      {
      if( rules.get(i) != VOLUME )
        {
        // Don't count volume in duration
        String durationString = durations.get(i);
        duration += Duration.getDuration0(durationString);
        }
      }
    return duration;
    }

/**
 * Realizes the Pattern into a sequencable Polylist
 *
 * @param chord the ChordSymbol to use for the bassline
 * @param nextChord the ChordSymbol that comes next in the progression
 * @param lastNote a NoteSymbol containing the previous bassline note
 * @return A Polylist of NoteSymbol objects that make up the bassline. Note:
 * Bassline is built in reverse by consing, then reversed as the final step.
 */
public LinkedList<Object> applyRules(ChordSymbol chord, ChordSymbol nextChord,
                           NoteSymbol lastNote)
  {
    //System.out.println("last Note is " + lastNote.getMIDI() );
    Iterator<Integer> i = rules.iterator();
    Iterator<String> j = durations.iterator();
    Iterator<String> m = modifiers.iterator();

    LinkedList<Object> basslineSegment = new LinkedList<Object>();
//System.out.println("in applyRules");
    String chordRoot = chord.getRootString();
    ChordForm chordForm = chord.getChordForm();
    Key key = chordForm.getKey(chordRoot);
    int rise = PitchClass.findRise(chordRoot);

    // indicator for directional placement
    int indicator = STAY;

    int volume = 127;

    while( i.hasNext() )
      {
        int rule = i.next();
        String duration = j.next();
        String modifier = m.next();
        MelodySymbol melodySymbol;
//System.out.println("applying bass rule " + rule + ", duration = " + duration + ", modifier = " + modifier);
        switch( rule )
          {
            case VOLUME:
              {
                melodySymbol = new VolumeSymbol(duration);
                //System.out.println("creating VolumeSymbol: " + melodySymbol);
                break;
              }

            case PITCH: // Allow X for bass too, 
            // as a convenience in cutting and pasting in editor
            case BASS:
              {
                melodySymbol = new NoteSymbol(chord.getBass());
                break;
              }

            case NEXT:
              {
                // FIX: This may be broken (octave jumps). Please check
                NoteSymbol noteSymbol = new NoteSymbol(nextChord.getBass());
                if( i.hasNext() )
                  {
                    melodySymbol = noteSymbol;
                  }
                else
                  {
                    melodySymbol = new NoteSymbol(
                            noteSymbol.getPitchClass(),
                            noteSymbol.getOctave(),
                            Duration.getDuration0(duration));
                  }
                Polylist L = Polylist.list(duration, melodySymbol);
                basslineSegment.add(L);
                return basslineSegment;
              }

            case CHORD:
              {
                Polylist chordTones =
                        (Polylist) chordForm.getSpell(chordRoot, key);
                if( chordTones.length() > 1 )
                  {
                    chordTones = lastNote.enhDrop(chordTones);
                  }
                melodySymbol = (NoteSymbol) getRandomItem(chordTones);

                break;
              }

            case SCALE:
              {
                Polylist scales = (Polylist) chordForm.getScales();
                if( scales == null || scales.isEmpty() )
                  {
                    Polylist chordTones =
                            (Polylist) chordForm.getSpell(chordRoot, key);
                    if( chordTones.length() > 1 )
                      {
                        chordTones = lastNote.enhDrop(chordTones);
                      }
                    melodySymbol = (NoteSymbol) getRandomItem(chordTones);
                    break;
                  }
                Polylist scale = (Polylist) scales.first();

                NoteSymbol tonic =
                        NoteSymbol.makeNoteSymbol((String) scale.first());

                String scaleType =
                        Advisor.concatListWithSpaces(scale.rest());

                ScaleForm scaleForm = Advisor.getScale(scaleType);

                Polylist tones = scaleForm.getSpell(tonic);
                tones = NoteSymbol.transposeNoteSymbolList(tones, rise);
                tones = tones.reverse().rest().reverse();

                Polylist seconds = getIntervals(2, tones, lastNote);
                Polylist thirds = getIntervals(3, tones, lastNote);
                tones = seconds.append(thirds);

                if( tones.length() > 1 )
                  {
                    tones = lastNote.enhDrop(tones);
                  }
                melodySymbol = (NoteSymbol) getRandomItem(tones);


                break;
              }

            case APPROACH:
              {
                NoteSymbol noteSymbol = new NoteSymbol(nextChord.getBass());
                Polylist approach = Polylist.list(noteSymbol.transpose(1),
                                                  noteSymbol.transpose(-1));
                if( approach.length() > 1 )
                  {
                    approach = lastNote.enhDrop(approach);
                  }

                melodySymbol = (NoteSymbol) getRandomItem(approach);
                break;
              }

            case REST:
              {
                melodySymbol = NoteSymbol.makeNoteSymbol("r");
                break;
              }

            case EQUAL:
              {
                melodySymbol = new NoteSymbol(lastNote); 
                break;
              }

            default:
              {                             // higher than 99 means flat/sharp
                if( (rule > 0 && rule < 11) || rule > 99 )
                  {
                    Polylist scales = chordForm.getScales();

                    if( scales == null || scales.isEmpty() )
                      {
                        Polylist chordTones =
                                 chordForm.getSpell(chordRoot, key);
                        if( chordTones.length() > 1 )
                          {
                            chordTones = lastNote.enhDrop(chordTones);
                          }
                        melodySymbol = (NoteSymbol) getRandomItem(chordTones);
                        break;
                      }

                    Polylist scale = (Polylist) scales.first();

                    NoteSymbol tonic =
                            NoteSymbol.makeNoteSymbol((String) scale.first());

                    String scaleType =
                            Advisor.concatListWithSpaces(scale.rest());

                    ScaleForm scaleForm = Advisor.getScale(scaleType);

                    Polylist tones = scaleForm.getSpell(tonic);
                    tones = NoteSymbol.transposeNoteSymbolList(tones, rise);
                    tones = tones.reverse().rest().reverse();

                    // flattened notes
                    if( rule > FLATTEN && rule < FLATTEN + 11 )
                      {
                        rule = rule - FLATTEN;
                        NoteSymbol noteSymbol = getInterval(rule, tones);
                        melodySymbol = noteSymbol.transpose(-1);
                      }   // sharpened notes
                    else if( rule > SHARPEN && rule < SHARPEN + 11 )
                      {
                        rule = rule - SHARPEN;
                        NoteSymbol noteSymbol = getInterval(rule, tones);
                        melodySymbol = noteSymbol.transpose(1);
                      }
                    else
                      {
                        melodySymbol = getInterval(rule, tones);
                      }
                  }
                else
                  {
                    melodySymbol = new NoteSymbol(chord.getBass());
                  }

                break;
              }

          }
        
        if( melodySymbol != null )
          {
            if( melodySymbol instanceof NoteSymbol )
              {
                NoteSymbol noteSymbol = (NoteSymbol) melodySymbol;

                if( !noteSymbol.isRest() && rule != EQUAL )
                  {
                    // System.out.println("Original melodySymbol is " + melodySymbol.getMIDI() );

                    // Why -24??

                    noteSymbol = noteSymbol.transpose(-24);
                    //pitch = placePitchNear(melodySymbol, lastNote, style);

                    if( modifier.equals("U") )
                      {
                        noteSymbol = placePitchAbove(noteSymbol, lastNote);
                      }
                    else if( modifier.equals("D") )
                      {
                        noteSymbol = placePitchBelow(noteSymbol, lastNote);
                      }
                    else if( modifier.equals("DD") )
                      {
                        noteSymbol = placePitchOctaveBelow(noteSymbol, lastNote);
                      }
                    else
                      {
                        noteSymbol = placePitchNear(noteSymbol, lastNote, style);
                        noteSymbol = pressure(noteSymbol, style);
                      }
                  }

                NoteSymbol note = new NoteSymbol(
                        noteSymbol.getPitchClass(),
                        noteSymbol.getOctave(),
                        Duration.getDuration0(duration),
                        volume);

                basslineSegment.add(note);

                if( !note.isRest() )
                  {
                    lastNote = note;
                  }
              }
            else if( melodySymbol instanceof VolumeSymbol )
              {
                basslineSegment.add(melodySymbol);
              }
            else
              {
                assert false;
              }
          }
      //System.out.println("rule = " + ruleTypes[rule] + " melodySymbol = " + melodySymbol);
      }
    
    return basslineSegment;
  }

  /**
   * Returns a random item from a given Polylist.
   * @param L         a Polylist to return an item from
   * @return a random Object from the Polylist
   */
  public static Object getRandomItem(Polylist L)
    {
    L = filterOutStrings(L);
    return L.nth(gen.nextInt(L.length()));
    }

  public static Polylist filterOutStrings(Polylist L)
    {
    PolylistBuffer buffer = new PolylistBuffer();
    while( L.nonEmpty() )
      {
        Object ob = L.first();
        if( !(ob instanceof String) )
          {
            buffer.append(ob);
          }
        L = L.rest();
      }
    
    return buffer.toPolylist();
    }
  
  
  /**
   * Takes a list of notes and an index interval and returns the
   * NoteSymbol at that index.
   * @param interval  an int representing the index interval to access
   * @param notes     a Polylist of NoteSymbol objects
   * @return a NoteSymbol at the proper index interval
   */
public static NoteSymbol getInterval(int interval, Polylist notes)
    {
    if( interval > 10 )
        {
        interval = interval - 10;
        }
    interval = (interval % 11 - 1) % notes.length();// FIX!
    return (NoteSymbol)notes.nth(interval);
    }
  
  /**
   * Returns the notes that are a certaing index interval away from a given
   * root.
   * @param interval  an int representing the index interval to access
   * @param notes     a Polylist of NoteSymbol objects
   * @param root      a NoteSymbol being the reference point to index from
   * @return a Polylist of NoteSymbols representing the index interval in
   *         either direction from the root
   */
  public static Polylist getIntervals(int interval, Polylist notes,
                                        NoteSymbol root)
    {
    interval = interval % 7 - 1;

    int rootPos = -1;
    for( int i = 0; i < notes.length(); i++ )
      {
      if( notes.nth(i) instanceof NoteSymbol &&
              ((NoteSymbol)notes.nth(i)).enharmonic(root) )
        {
        rootPos = i;
        break;
        }
      }

    assert (rootPos != -1);

    Polylist L = Polylist.nil;
    L = L.cons(notes.nth((rootPos + interval) % notes.length()));
    L = L.cons(notes.nth((rootPos - interval + notes.length()) % notes.length()));

    return L;
    }



public static NoteSymbol placePitchAbove(NoteSymbol pitch,
                                           NoteSymbol base)
    {
    int semitones = base.getSemitonesAbove(pitch);
    return base.transpose(semitones);
    }

  
  /**
   * Takes a melodySymbol NoteSymbol and a base NoteSymbol and transposes the
   * melodySymbol to be within the octave below the base.
   * @param melodySymbol     a NoteSymbol that is the melodySymbol to place
   * @param base      a NoteSymbol that is the base note
   * @return a NoteSymbol that is the placed melodySymbol
   */
  public static NoteSymbol placePitchBelow(NoteSymbol pitch,
                                           NoteSymbol base)
    {
    // Note the role reversal of melodySymbol and base from the previous method
    int semitones = pitch.getSemitonesAbove(base);
    return base.transpose(-semitones);
    }
  
    public static NoteSymbol placePitchOctaveBelow(NoteSymbol pitch,
                                           NoteSymbol base)
    {
    // Note the role reversal of melodySymbol and base from the previous method
    int semitones = pitch.getSemitonesAbove(base);
    return base.transpose(-semitones).transpose(-12);
    }

  
  /**
   * Takes a melodySymbol NoteSymbol and a base NoteSymbol and transposes the
   * melodySymbol to be near the base and within the given range.
   * @param melodySymbol     a NoteSymbol that is the melodySymbol to place
   * @param base      a NoteSymbol that is the base note
   * @param low       a NoteSymbol that is the lower range
   * @param high      a NoteSymbol that is the upper range
   * @return a NoteSymbol that is the placed melodySymbol
   */
  public static NoteSymbol placePitchNear(NoteSymbol pitch,
                                          NoteSymbol base,
                                          Style style)
    {
    NoteSymbol low = style.getBassLow();
    NoteSymbol high = style.getBassHigh();
    //System.out.println("placePitchNear " + melodySymbol + ", style = " + style + ", low = " + low + ", base = " + base + ", high = " + high);
    int rise = base.getSemitonesAbove(pitch);
    NoteSymbol note;

    // Pitch octave placement is the subject of some experimentation.
  /*  
    boolean drop_down = base.getDuration() >= BEAT || rise >= BIG_RISE;

    if( drop_down )
      {
      note = placePitchBelow(melodySymbol, base);
      if( note.getMIDI() < low.getMIDI() - MARGIN )
        {
        note = note.transpose(12);
        // note = placePitchAbove(melodySymbol, base);
        }
     //System.out.println("base = " + base + ", rise = " + rise + ", note = " + note + " below");
     }
    else
      {
      note = placePitchAbove(melodySymbol, base);
      if( note.getMIDI() > high.getMIDI() + MARGIN )
        {
        note = note.transpose(-12);
        // note = placePitchBelow(melodySymbol, base);
        }
     //System.out.println("base = " + base + ", rise = " + rise + ", note = " + note + " above");
      }*/

      while( pitch.getMIDI() > base.getMIDI() + MARGIN ||
                pitch.getMIDI() < base.getMIDI() - MARGIN)
      {
      double rand = java.lang.Math.random();
      if( rand < 0.5 )
      {
       if( pitch.getMIDI() > base.getMIDI() + MARGIN )
        pitch = pitch.transpose(-12);
       else if( pitch.getMIDI() < base.getMIDI() - MARGIN )
        pitch = pitch.transpose(12);
      }
      else
      {
       if( pitch.getMIDI() < base.getMIDI() - MARGIN )
        pitch = pitch.transpose(12);
       else if( pitch.getMIDI() > base.getMIDI() + MARGIN )
        pitch = pitch.transpose(-12);
      }
      //  System.out.println("PITCH IS " + melodySymbol.getMIDI());
      }
      return pitch;
    }


  /**
   * Takes a melodySymbol NoteSymbol and a range and transposes the
   * melodySymbol probabilistically based on its position in the range.
   * @param melodySymbol     a NoteSymbol that is the melodySymbol to place
   * @param low       a NoteSymbol that is the lower range
   * @param high      a NoteSymbol that is the upper range
   * @return a NoteSymbol that is the placed melodySymbol
   */
  public static NoteSymbol pressure( NoteSymbol pitch, Style style )
    {
    NoteSymbol low = style.getBassLow();
    NoteSymbol high = style.getBassHigh();

    // find the center by going up from the low
   int hardmargin = high.getSemitonesAbove(low);
   // For some reason hardmargin is only half as large as I'd like
   NoteSymbol center = low.transpose(hardmargin);
 //  System.out.println("high " + high.getMIDI() + " low " + low.getMIDI() + " center " + center.getMIDI());

   NoteSymbol softmarginhigh = center.transpose(SOFTMARGIN);
   NoteSymbol softmarginlow = center.transpose(-SOFTMARGIN);

   // take probability linearly based on melodySymbol position in margins
   if( pitch.getMIDI() > softmarginhigh.getMIDI() ) 
    {
    int numerator = pitch.getMIDI() - softmarginhigh.getMIDI();
    int denominator = high.getMIDI() - softmarginhigh.getMIDI();
    double prob = (double)numerator / (double)denominator;
    prob = prob*prob*prob*prob;
    double rand = java.lang.Math.random();
    if( prob > rand )
     {
        pitch = pitch.transpose(-12);
     }
    }
   else if( pitch.getMIDI() < softmarginlow.getMIDI() )
    {
    int numerator = softmarginlow.getMIDI() - pitch.getMIDI();
    int denominator = softmarginlow.getMIDI() - low.getMIDI();
    double prob = (double)numerator / (double)denominator;
    prob = prob*prob*prob*prob;
    double rand = java.lang.Math.random();
    if( prob > rand )
     {
     pitch = pitch.transpose(12);
     }
    }
    //System.out.println("New melodySymbol is " + melodySymbol.getMIDI());
    return pitch;
   }


  //Added summer2007 for use with Style GUI
  public String forGenerator()
    {
    StringBuilder buffer = new StringBuilder();
    
    for( int i = 0; i < durations.size(); i++ )
      {
      //System.out.println("i: " + i);

      int ruleIndex = rules.get(i);
      // Note that ruleIndex can have FLATTEN or SHARPEN added to it.
      // Need to subtract these before indexing array.

      String accidental = "";

      if( ruleIndex > SHARPEN )
      {
          ruleIndex -= SHARPEN;
          accidental = "#";
      }
      else if( ruleIndex > FLATTEN )
      {
          ruleIndex -= FLATTEN;
          accidental = "b";
      }

      String nextNote = ruleTypes[ruleIndex];
      try
        {
        Integer.parseInt(nextNote);
        buffer.append("(X ");
        buffer.append(accidental);
        buffer.append(nextNote);
        buffer.append(" ");
        buffer.append(durations.get(i));
        buffer.append(" ");
        buffer.append(modifiers.get(i));
        buffer.append(") ");
        }
      catch( NumberFormatException e )
        {
        buffer.append(nextNote);
        buffer.append(durations.get(i));
        buffer.append(" ");
        }
      }
    return buffer.toString();
    }

  @Override
  public String toString()
    {
      return "BassPattern rules = " + rules + ", durations = " + durations + ", totalDuration = " + getDuration();
    }
  
    public String getName()
    {
      return patternName;
    }
    
    public LinkedHashMap getDefinedRules()
    {
        return definedRules;
    }
    
    public void setDefinedRules(LinkedHashMap map)
    {
        if( map.isEmpty() )
        {
            return;
        }
        else
        {
            definedRules = map;   
        }
    }
  
  }

```

### File: src\imp\style\Style.java

```java

/**
 * This Java Class is part of the Impro-Visor Application
 *
 * Copyright (C) 2005-2018 Robert Keller and Harvey Mudd College
 *
 * Impro-Visor is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * Impro-Visor is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * merchantability or fitness for a particular purpose.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Impro-Visor; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 */

package imp.style;

import imp.midi.MidiSequence;
import imp.midi.MidiSynth;
import imp.style.stylePatterns.BassPattern;
import imp.style.stylePatterns.Pattern;
import imp.style.stylePatterns.DrumPattern;
import imp.style.stylePatterns.Interpolant;
import imp.style.stylePatterns.ChordPatternVoiced;
import imp.style.stylePatterns.ChordPattern;
import imp.style.stylePatterns.Interpolable;
import imp.style.stylePatterns.Substitution;
import imp.data.advice.Advisor;
import imp.Constants;
import static imp.Constants.BEAT;
import static imp.Constants.CUSTOM;
import static imp.Constants.ENDSCORE;
import static imp.Constants.MAX_VOLUME;
import imp.ImproVisor;
import imp.com.PlayScoreCommand;
import imp.data.Chord;
import imp.data.ChordPart;
import imp.data.ChordSymbol;
import imp.data.DrumLine;
import imp.data.Duration;
import imp.data.Leadsheet;
import imp.data.MelodyPart;
import imp.data.MelodySymbol;
import imp.data.Note;
import imp.data.NoteSymbol;
import imp.data.Part;
import imp.data.PitchClass;
import imp.data.Rest;
import imp.data.Transposition;
import imp.data.VolumeSymbol;
import imp.roadmap.brickdictionary.ChordBlock;
import imp.util.Preferences;
import imp.voicing.AVPFileCreator;
import imp.voicing.AutomaticVoicingSettings;
import imp.voicing.HandManager;
import imp.voicing.VoicingGenerator;
import java.io.BufferedWriter;
import java.io.File;
import java.io.IOException;
import java.io.Serializable;
import java.util.*;
import javax.sound.midi.InvalidMidiDataException;
import javax.sound.midi.Sequence;
import javax.sound.midi.Track;
import polya.Polylist;
import polya.PolylistBuffer;
import polya.PolylistEnum;


/**
 * An object that contains patterns and parameters for generating an
 * accompaniment.
 * Contains functions to create a Style from text, output a Style to text,
 * and, given a ChordPart, arrange patterns to construct an accompaniment.
 * @see         Pattern
 * @see         BassPattern
 * @see         DrumPattern
 * @see         ChordPattern
 * @see         ChordPart
 * @author      Stephen Jones, Robert Keller
 */
public class Style
        implements Constants, Serializable
  {
  private static LinkedHashMap<String, Style> allStyles = new LinkedHashMap<String, Style>();
  
  private static ArrayList<Style> orderedStyles = null;
  
  private static String defaultStyleName = "no-style";
  
  public static final String USE_PREVIOUS_STYLE = "*";
  
  private static int defaultDrumPatternDuration = 480;
  
  private AutomaticVoicingSettings avs;

  private VoicingGenerator vgen;
  
  private HandManager handyMan;

  /**
   * the random number generator for styles
   */
  private static Random gen = new Random();

  /**
   * a String containing the name
   */
  private String name = defaultStyleName;

  /**
   * a String containing the default name of a Style (a so-called NULL Style)
   */
  public static String NULL = "";

  /**
   * a boolean that determines whether to use "no-style" behavior
   */
  private boolean noStyle = false;

  /**
   * a String containing comments on the Style
   */
  private String comments = "";

  /**
   * a double containing the swing value
   */
  private double swing = 0.5;

  /**
   * a double containing the swing value
   */
  private double accompanimentSwing = 0.5;

  /**
   * a String determining the voicing type
   */
  private String voicingType = "closed";
  
  /**
   * The name of the voicing file to use for the style
   */  
  private String voicingFileName = "default.fv";
  /**
   * a boolean that determines whether to automatically extend chords
   */
  private boolean useExtensions = false;

  /**
   * a Polylist of NoteSymbol objects that determine the base chord from 
   * which to voice-lead
   */
  private Polylist chordBase = Polylist.list(
          NoteSymbol.makeNoteSymbol("c-"),
          NoteSymbol.makeNoteSymbol("e-"),
          NoteSymbol.makeNoteSymbol("g-"));

  /**
   * a NoteSymbol determining the lower range of the chord progression
   */
  private NoteSymbol chordLow = NoteSymbol.makeNoteSymbol("c-");

  /**
   * a NoteSymbol determining the upper range of the chord progression
   */
  private NoteSymbol chordHigh = NoteSymbol.makeNoteSymbol("a");

 
  /**
   * an int determining the MIDI instrument for chords
   */
  static private int chordInstrument = 1;

  /**
   * an int determining the MIDI instrument for bass
   */
  static private int bassInstrument = 33;

  /**
   * a NoteSymbol determining the lower range for bass
   */
  private NoteSymbol bassLow = NoteSymbol.makeNoteSymbol("g---");

  /**
   * a NoteSymbol determining the higher range for bass
   */
  private NoteSymbol bassHigh = NoteSymbol.makeNoteSymbol("g-");

  /**
   * a ArrayList of this Style's BassPattern objects
   */
  private ArrayList<BassPattern> bassPatterns = new ArrayList<BassPattern>();

  /**
   * a ArrayList of this Style's DrumPattern objects
   */
  private ArrayList<DrumPattern> drumPatterns = new ArrayList<DrumPattern>();

  /**
   * a ArrayList of this Style's ChordPattern objects
   */
  private ArrayList<ChordPattern> chordPatterns = new ArrayList<ChordPattern>();
  
  private Polylist interpolations = Polylist.nil;
  
  private Polylist interpolables = Polylist.nil;
  
  private Polylist substitutions = Polylist.nil;
  
  private Polylist definedInterpolations = Polylist.nil;
  
  private Polylist definedInterpolables = Polylist.nil;
  
  private Polylist definedSubstitutions = Polylist.nil;
  
  /**
   * HashMaps for each of the different instruments to save the rules defined
   * outside the patterns
   */
  private LinkedHashMap<String, Polylist> bassDefinedRules = 
          new LinkedHashMap<String, Polylist>();
  
  private LinkedHashMap<String, Polylist> chordDefinedRules = 
          new LinkedHashMap<String, Polylist>();
  
  private LinkedHashMap<String, Polylist> drumDefinedRules = 
          new LinkedHashMap<String, Polylist>();

  /**
   * a String array containing keywords used in Style specifications
   */
  private static String keyword[] = {"name", "bass-pattern", "bass-high",
                                       "bass-low", "bass-base", "swing",
                                       "drum-pattern", "chord-pattern",
                                       "chord-high", "chord-low", "chord-base",
                                       "use-extensions", "no-style",
                                       "voicing-type", "comments",
                                       "comp-swing", "define-rule", "bass",
                                       "chord", "drum", "voicing-name", "interpolate",
                                       "interpolable", "substitute"
  };

  // indices into the keyword array
  private static final int NAME = 0;

  private static final int BASS_PATTERN = 1;

  private static final int BASS_HIGH = 2;

  private static final int BASS_LOW = 3;

  private static final int BASS_BASE = 4;

  private static final int SWING = 5;

  private static final int DRUM_PATTERN = 6;

  private static final int CHORD_PATTERN = 7;

  private static final int CHORD_HIGH = 8;

  private static final int CHORD_LOW = 9;

  private static final int CHORD_BASE = 10;

  private static final int USE_EXTENSIONS = 11;

  private static final int NO_STYLE = 12;

  private static final int VOICING_TYPE = 13;

  private static final int COMMENTS = 14;

  private static final int ACCOMPANIMENT_SWING = 15;
  
  private static final int DEFINE_RULE = 16;
  
  private static final int BASS = 17;
  
  private static final int CHORD = 18;
  
  private static final int DRUM = 19;
  
  private static final int VOICING_FILE = 20;

  private static final int INTERPOLATE = 21;
  
  private static final int INTERPOLABLE = 22;

  private static final int SUBSTITUTE = 23;

  public boolean usePreviousStyle()
    {
      return name.equals(USE_PREVIOUS_STYLE);
    }
  
  public static Style getStyle(String name)
    {
    //System.out.println("getStyle " + name);
     Style s = allStyles.get(name);

      return s;
    }
  
  public static void setStyle(String name, Style style)
    {
      allStyles.put(name, style);
    }
  
  public static boolean noStyles()
    {
      return numberOfStyles() == 0;
    }
  
  public static int numberOfStyles()
    {
      ensureStyleArray();
      return orderedStyles.size(); 
    }
  
  /**
   * Used by StyleList in Notate.
   * @param index
   * @return 
   */
  
    public static Style getNth(int index)
      {
        ensureStyleArray();
        return orderedStyles.get(index);
      }
    
    private static void ensureStyleArray()
      {
        //if( orderedStyles == null )
            {
            orderedStyles = new ArrayList<Style>(allStyles.values());
            }       
      }
  
  /**
   * Gets the voicing type.
   * @return the voicing type
   */
  public String getVoicingType()
    {
    return voicingType;
    }

  public boolean hasCustomVoicing()
    {
      return voicingType.equals(CUSTOM);
    }
  
  public ArrayList<BassPattern> getBP()
    {
    return bassPatterns;
    }

  public ArrayList<DrumPattern> getDP()
    {
    return drumPatterns;
    }

  public ArrayList<ChordPattern> getCP()
    {
    return chordPatterns;
    }

  public Polylist getInterpolations()
  {
      return interpolations;
  }
  
  public Polylist getInterpolables()
  {
      return interpolables;
  }
  
  public Polylist getSubs()
  {
      return definedSubstitutions;
  }
  
  public Polylist getDefinedInterpolations()
  {
      return definedInterpolations;
  }
  
  public Polylist getDefinedInterpolables()
  {
      return definedInterpolables;
  }
  
  public Polylist getDefinedSubs()
  {
      return definedSubstitutions;
  }

  public int getDrumPatternDuration()
    {
    if( drumPatterns.size() > 0 )
      {
      return drumPatterns.get(0).getDuration();
      }
    else
      {
      return defaultDrumPatternDuration;
      }
    }

  /**
   * Returns the number of total patterns--all of bass, chords, and drums.
   *
   */
  public int getTotalPatterns()
    {
    return bassPatterns.size() + chordPatterns.size() + drumPatterns.size();
    }


  /**
   * Gets the name.
   * @return the name
   */
  public String getName()
    {
    return name;
    }
  
  public void setName(String name)
    {
      this.name = name;
    }

  /**
   * Gets the comments.
   * @return the comments
   */
  public String getComments()
    {
    return comments;
    }

  /**
   * Sets the comments.
   * @param c         a String containing the comments
   */
  public void setComments(String c)
    {
    comments = c;
    }

  /**
   * Returns the name.
   * @return the name of this Style
   */
  @Override
  public String toString()
    {
    return getName();
    }

  /**
   * Returns the swing value.
   * @return the swing value
   */
  public double getSwing()
    {
    return swing;
    }

  /**
   * Returns the accompaniment swing value.
   * @return the accompaniment swing value
   */
  public double getAccompanimentSwing()
    {
    //System.out.println("accompanimentSwing = " + accompanimentSwing);
    return accompanimentSwing;
    }

  /**
   * Sets the swing value.
   * @param s         a double containing the swing value
   */
  public void setSwing(double s)
    {
      //System.out.println("setting swing of " + name + " to " + s);
    swing = s;
    }

  /**
   * Sets the accompaniment swing value.
   * @param s         a double containing the accompaniment swing value
   */
  public void setAccompanimentSwing(double s)
    {
    accompanimentSwing = s;
    }

  /**
   * Sets the chord instrument.
   * @param inst      an int containing the chord instrument
   */
  public void setChordInstrument(int inst, String caller)
    {
    chordInstrument = inst;
    }

  /**
   * Gets the chord instrument.
   * @return the chord instrument
   */
  public int getChordInstrument()
    {
    return chordInstrument;
    }

  /**
   * Sets the bass instrument.
   * @param inst      an int containing the chord instrument
   */
  public void setBassInstrument(int inst)
    {
    bassInstrument = inst;
    }

  /**
   * Gets the bass instrument.
   * @return the bass instrument
   */
  public int getBassInstrument()
    {
    return bassInstrument;
    }
  
  /**
   * gets the defined rules for each instrument
   * @return the Linked Hash Map of rules
   */
  public LinkedHashMap getBassDefinedRules()
  {
      return bassDefinedRules;
  }
  
  public LinkedHashMap getChordDefinedRules()
  {
      return chordDefinedRules;
  }
  
  public LinkedHashMap getDrumDefinedRules()
  {
      return drumDefinedRules;
  }

    /**
     * 
     * @return voicing file name to search for in voicing directory
     */
    public String getVoicingFileName() {
        return voicingFileName;
    }
    /**
     * 
     * @param voicingFileName voicing file name to search for in voicing directory
     */
    public void setVoicingFileName(String voicingFileName) {
        this.voicingFileName = voicingFileName;
    }
    
  /**
   * Returns the noStyle parameter.
   * @return determines whether this is a "no-Style"
   */
  public boolean noStyle()
    {
    return noStyle;
    }

  /**
   * Sets the noStyle parameter.
   * @param basslineSegment         a boolean determining whether this is a "no-style"
   */
  public void setNoStyle(boolean b)
    {
    noStyle = b;
    }

  /**
   * Creates a default Style (considered a NULL Style).
   */
  public Style()
    {
    }

  /**
   * Returns a copy of the Style.
   * @return a copy of the Style
   */
  public Style copy()
    {
    Style style = new Style();

    style.noStyle = noStyle;
    style.setSwing(swing);
    style.setAccompanimentSwing(accompanimentSwing);
    style.chordBase = chordBase;
    style.chordLow = chordLow;
    style.chordHigh = chordHigh;
    style.bassLow = bassLow;
    style.bassHigh = bassHigh;
    style.comments = comments;
    style.voicingType = voicingType;
    style.voicingFileName=voicingFileName;
    style.useExtensions = useExtensions;

    style.name = name;

    style.bassPatterns = bassPatterns;
    style.drumPatterns = drumPatterns;
    style.chordPatterns = chordPatterns;
    style.interpolations = interpolations;
    style.interpolables = interpolables;
    style.substitutions = substitutions;
    return style;
    }

  /**
   * A factory for creating a new Style from a Polylist.
   * @param  L        a Polylist containing Style information
   * @return the Style created from the Polylist, or null if there
   *         was a problem
   */
  public static Style makeStyle(Polylist L)
    {
    Style style = new Style();
    //interpolations = Polylist.nil;
    //style.voicingFileName="default.avp";
    while( L != null && L.nonEmpty() )
      {
      if( (L.first() instanceof Polylist) )
        {
        Polylist item = (Polylist)L.first();
        L = L.rest();

        if( item.nonEmpty() )
          {
          Object dispatcher = item.first();
          item = item.rest();

          switch( Leadsheet.lookup((String)dispatcher, keyword) )
            {
              case DEFINE_RULE:
              {
                  style.makeDefinedRules(item); 
                  break;
              }
            case CHORD_PATTERN:
              {
                  ChordPattern cp = new ChordPattern();
                  cp.setStyle(style);
                  cp.setDefinedRules(cp.getStyle().getChordDefinedRules());
                  cp.makePattern(item);
                style.chordPatterns.add(cp);
              break;
              }
            case DRUM_PATTERN:
              {
              DrumPattern dp = new DrumPattern();
              dp.setStyle(style);
              dp.setDefinedRules(dp.getStyle().getDrumDefinedRules());
              dp.makePattern(item);
                style.drumPatterns.add(dp);
              break;
              }
            case BASS_PATTERN:
              {
                  BassPattern bp = new BassPattern();
                  bp.setStyle(style);
                  bp.setDefinedRules(bp.getStyle().getBassDefinedRules());
                  bp.makePattern(item);
                style.bassPatterns.add(bp);
              break;
              }
            case VOICING_TYPE:
              {
              style.voicingType = (String)item.first();
              break;
              }
            case COMMENTS:
              {
              String commentsString = Leadsheet.concatElements(item);
              style.comments = commentsString;
              break;
              }
            case NAME:
              {
              style.name = (String)item.first();
              break;
              }
            case VOICING_FILE:
              {
              style.voicingFileName = (String)item.first();
              break;
              }
            case INTERPOLATE:
            {
              //  System.out.println(item);
                Interpolant interpolant = Interpolant.makeInterpolantFromExp(item);
                style.definedInterpolations = style.definedInterpolations.cons(item.cons("interpolate "));
              //  System.out.println(interpolant);
                style.interpolations = style.interpolations.cons(interpolant);
                break;
            }
            case INTERPOLABLE:
            {
                Interpolable interpolable = Interpolable.makeInterpolableFromExp(item);
                style.definedInterpolables = style.definedInterpolables.cons(item.cons("interpolable "));
                style.interpolables = style.interpolables.cons(interpolable);
                break;
            }
            case SUBSTITUTE:
            {
              //  System.out.println(item);
                Substitution sub = Substitution.makeSubstitutionFromExp(item);
                style.definedSubstitutions = style.definedSubstitutions.cons(item.cons("substitute "));
              //  System.out.println(sub);
                style.substitutions = style.substitutions.cons(sub);
                break;
            }
            default:
              {
              style.load((String)dispatcher, item);
              break;
              }
            }
          }
        }
      else
        {
        L = L.rest();
        }
      }
    
    if( style.hasCustomVoicing() )
        {
        String vfn = ImproVisor.getVoicingDirectory() + File.separator + style.voicingFileName;
        AutomaticVoicingSettings av = new AutomaticVoicingSettings();
        AVPFileCreator.fileToSettings(new File(vfn), av);
        style.avs = av;
        
        style.handyMan = new HandManager();
        style.handyMan.getSettings(av);
        
        style.vgen = new VoicingGenerator();
        style.vgen.getVoicingSettings(av);
        }
    
     return style;
    }

  public HandManager getHandManager()
  {
      return handyMan;
  }
  
  public VoicingGenerator getVoicingGenerator()
  {
      return vgen;
  }
  
  /**
   * A method to change parameters of an already constructed Style
   * from text specification.
   * @param dispatcher        a String containing a Style keyword
   * @param item              a Polylist containing the arguments for
   *                          dispatcher's Style keyword
   */
  public void load(String dispatcher, Polylist item)
    {
    switch( Leadsheet.lookup(dispatcher, keyword) )
      {
      case BASS_HIGH:
        {
        bassHigh = NoteSymbol.makeNoteSymbol((String)item.first());
        break;
        }
      case BASS_LOW:
        {
        bassLow = NoteSymbol.makeNoteSymbol((String)item.first());
        break;
        }
       case CHORD_HIGH:
        {
        chordHigh = NoteSymbol.makeNoteSymbol((String)item.first());
        break;
        }
      case CHORD_LOW:
        {
        chordLow = NoteSymbol.makeNoteSymbol((String)item.first());
        break;
        }
      case CHORD_BASE:
        {
        PolylistEnum chord = item.elements();
        
        PolylistBuffer base = new PolylistBuffer();
        
        while( chord.hasMoreElements() )
          {
          NoteSymbol note =
                  NoteSymbol.makeNoteSymbol((String)chord.nextElement());
          
          base.append(note);
          }
        chordBase = base.toPolylist();
        break;
        }
      case SWING:
        {
        swing = (Double)item.first();
        break;
        }
      case ACCOMPANIMENT_SWING:
        {
        accompanimentSwing = (Double)item.first();
        break;
        }
      case USE_EXTENSIONS:
        {
        useExtensions = true;
        break;
        }
      case NO_STYLE:
        {
        noStyle = true;
        break;
        }
      }
    }
  
  /**
   * A method to add defined rules to the hash map that tracks them
   * @param L 
   */
  public void makeDefinedRules(Polylist L)
  {
      //e.g. L is (drum name (rules X4 R4 X4 R4))
      
      if( L.nonEmpty() )
      {
          if( L.first() instanceof String )
          {
              String dispatcher = (String) L.first();
              Polylist item = L.rest();
              
              switch( Leadsheet.lookup(dispatcher, keyword) )
              {
                  case BASS:
                  {
                      if( item.first() instanceof String )
                      {
                          String ruleName = (String) item.first();
                          Polylist rules = (Polylist) item.second();
                          bassDefinedRules.put(ruleName, rules);
                      }
                      break;
                  }
                      
                  case CHORD:
                  {
                      if( item.first() instanceof String )
                      {
                          String ruleName = (String) item.first();
                          Polylist rules = (Polylist) item.second();
                          chordDefinedRules.put(ruleName, rules);
                      }
                      break;
                  }
                      
                  case DRUM:
                  {
                      if( item.first() instanceof String )
                      {
                          String ruleName = (String) item.first();
                          Polylist rules = (Polylist) item.second();
                          drumDefinedRules.put(ruleName, rules);
                      }
                      break;
                  }
              }
          }
      }
  }

  /**
   * Saves a Style to text format used in Leadsheets.
   * @param out       a BufferedWriter to write the Style to
   */
  public void saveLeadsheet(BufferedWriter out) throws IOException
    {
    out.write("(style " + name);
    out.newLine();
    out.write("    (" + keyword[SWING] + " " + swing + ")");
    out.newLine();
    out.write("    (" + keyword[ACCOMPANIMENT_SWING] + " " + swing + ")");
    out.newLine();
    out.write("    (" + keyword[BASS_HIGH] + " " + bassHigh.toPitchString() + ")");
    out.newLine();
    out.write("    (" + keyword[BASS_LOW] + " " + bassLow.toPitchString() + ")");
    out.newLine();
    out.write("    (" + keyword[CHORD_HIGH] + " " + chordHigh.toPitchString() + ")");
    out.newLine();
    out.write("    (" + keyword[CHORD_LOW] + " " + chordLow.toPitchString() + ")");
    out.newLine();
    out.write("    (" + keyword[VOICING_FILE] + " " + this.voicingFileName + ")");
    out.newLine();
    out.write("    " + NoteSymbol.makePitchStringList(chordBase).cons(keyword[CHORD_BASE]));
    out.newLine();

    if( noStyle )
      {
      out.write("    (" + keyword[NO_STYLE] + ")");
      }

    out.write(")");
    out.newLine();
    }

  /**
   * Sets the base chord.
   * @param list      a Polylist containing NoteSymbol objects that make up
   *                  the base chord
   */
  public void setChordBase(Polylist list)
    {
    chordBase = list;
    }

  /**
   * Sets the lower range for the chords.
   * @param low       a NoteSymbol determining the lower range for the chords
   */
  public void setChordLow(NoteSymbol low)
    {
    chordLow = low;
    }

  /**
   * Sets the higher range for the chords.
   * @param high      a NoteSymbol determining the higher range for the
   *                  chords
   */
  public void setChordHigh(NoteSymbol high)
    {
    chordHigh = high;
    }

  /**
   * Gets the chord base.
   * @return the chord base
   */
  public Polylist getChordBase()
    {
    return chordBase;
    }

  /**
   * Gets the upper range NoteSymbol.
   * @return the upper range
   */
  public NoteSymbol getChordHigh()
    {
    return chordHigh;
    }

  /**
   * Gets the lower range NoteSymbol.
   * @return the lower range
   */
  public NoteSymbol getChordLow()
    {
    return chordLow;
    }

  /**
   * Gets the upper range bass note.
   * @return the bass upper range
   */
  public NoteSymbol getBassHigh()
    {
    return bassHigh;
    }

  /**
   * Gets the lower range bass note.
   * @return the bass lower range
   */
  public NoteSymbol getBassLow()
    {
    return bassLow;
    }

  /**
   * Function that takes a ArrayList of Pattern objects and a duration, 
   * randomly chooses from the largest Patterns that will fit in that
   * duration, and returns that Pattern.
   * @param <T>       a type variable (referring to a type of Pattern)
   * @param patterns  a ArrayList of T objects to choose from
   * @param desiredDuration  an int determining the desiredDuration to fill
   * @return the Pattern chosen
   */
  private static <T extends Pattern> T getPattern(ArrayList<T> patterns,
                                                    int duration)
    {
    // this ArrayList will hold patterns that are the correct duration
    ArrayList<T> goodPatterns = new ArrayList<T>();

    // find the largest pattern duration that is less than duration
    int largestDuration = 0;
    for( int i = 0; i < patterns.size(); i++ )
      {
      T temp = patterns.get(i);
      int tempDuration = temp.getDuration();

      if( tempDuration > largestDuration &&
              tempDuration <= duration )
        {
        largestDuration = tempDuration;
        }
      }

    // if we don't have a short enough pattern, we'll play nothing
    if( largestDuration == 0 )
      {
      // NEW: Instead of playing nothing, find the shortest pattern
      // that is longer than duration and truncate it.
      int shortestDuration = Integer.MAX_VALUE;
      T shortestPattern = null;

      for( int i = 0; i < patterns.size(); i++ )
        {
        T temp = patterns.get(i);
        int tempDuration = temp.getDuration();

        if( tempDuration >= duration &&
                tempDuration < shortestDuration )
          {
          shortestDuration = tempDuration;
          shortestPattern = temp;
          }
        }
      return shortestPattern;
      }

    // sum the weights of the patterns we are choosing from
    double sum = 0;
    for( int i = 0; i < patterns.size(); i++ )
      {
      if( patterns.get(i).getDuration() == largestDuration )
        {
        sum += patterns.get(i).getWeight();
        goodPatterns.add(patterns.get(i));
        }
      }

    // randomly choose one of the "good patterns"
    int random = gen.nextInt((int)sum);
    double weights = 0;
    for( int i = 0; i < goodPatterns.size(); i++ )
      {
      weights += goodPatterns.get(i).getWeight();
      if( random < weights )
        {
        return goodPatterns.get(i);
        }
      }
    // should not occur
    return null;
    }
  
  ChordPattern residualChordPattern = null;
  
  private void setResidualChordPattern(ChordPattern pattern)
  {
      if( pattern != null && pattern.getDuration() == 0 )
        {
          pattern = null;
        }
      //System.out.println("residualChordPattern = " + pattern);
      residualChordPattern = pattern;
  }
  
  /**
   * Similar to getPattern, but specialized to ChordPattern
   * @param <T>       a type variable (referring to a type of Pattern)
   * @param patterns  a ArrayList of T objects to choose from
   * @param desiredDuration  an int determining the desiredDuration to fill
   * @return the Pattern chosen
   */
  private ChordPattern getChordPattern(ArrayList<ChordPattern> patterns,
                                           int desiredDuration)
    {
        //System.out.println("\ngetChordPattern of duration " + desiredDuration);
        // If there is a residual pattern, use it.
        if( residualChordPattern != null )
          {
            if( residualChordPattern.getDuration() <= desiredDuration )
              {
                ChordPattern result = residualChordPattern;
                //System.out.println("Using all of residual: " + result);
                setResidualChordPattern(null);
                return result;
              }
            ArrayList<ChordPattern> result = residualChordPattern.
                    splitChordPattern(desiredDuration);
            setResidualChordPattern(result.get(1));
            return result.get(0);
          }

        // Otherwise search for a pattern of duration >= the desired duration.
        ArrayList<ChordPattern> goodPatterns = new ArrayList<>();

        /*
         * begin commented out portion
         */
        double goodSum = 0;
        double allSum = 0;
        for( ChordPattern pattern : patterns )
          {
            double weight = pattern.getWeight();
            allSum += weight;
            if( pattern.getDuration() > desiredDuration )
              {
                goodPatterns.add(pattern);
                goodSum += weight;
              }
          }

        double weights = 0;
        if( goodSum > 0 )
          {
            // randomly choose one of the "good patterns"
            int random = gen.nextInt((int) goodSum);
            for( ChordPattern pattern : goodPatterns )
              {
                weights += pattern.getWeight();
                if( random <= weights )
                  {
                    ChordPattern selectedPattern = pattern;
                    if( selectedPattern.getDuration() == desiredDuration )
                      {
                        // If selectedPattern fits exactly, use it.
                        return selectedPattern;
                      }
                    // Otherwise split the selected pattern and use the first half.
                    ArrayList<ChordPattern> result = selectedPattern.
                            splitChordPattern(desiredDuration);
                    setResidualChordPattern(result.get(1));
                    return result.get(0);
                  }
              }
          }
        else
          {
            if( allSum == 0 )
              {
                return null; // no pattern
              }
            int random = gen.nextInt((int) allSum);
            for( ChordPattern pattern : patterns )
              {
                weights += pattern.getWeight();
                if( random <= weights )
                  {
                    if( pattern.getDuration() <= desiredDuration )
                      {
                        return pattern;
                      }
                    // Otherwise split the selected pattern and use the first half.
                    ArrayList<ChordPattern> result = pattern.splitChordPattern(desiredDuration);
                    setResidualChordPattern(result.get(1));
                    return result.get(0);
                  }
              }
          }
    
    // As a last result, select from all patterns regardless of duration
    
    //System.out.println("no ChordPattern of duration " + desiredDuration + " found");
    return null;
    }


  /**
   * Called from render in this file.
   * 
   * Using the DrumPattern objects of this Style, sequences a drumline
   * of a specified duration onto the track.
   * @param seq       the Sequence that contains the Track
   * @param track     the Track to put drum events on
   * @param time      a long containing the time to start the drumline
   * @param duration  an int containing the duration of the drumline
   */
  private void makeDrumline(MidiSequence seq, 
                            long time,
                            int duration, 
                            int endLimitIndex )
          throws InvalidMidiDataException
    {
    // tracing render info
    //System.out.println("drumline: time = " + time + " duration = " + duration
    // + " endLimitIndex = " + endLimitIndex);

    // loop until we've found patterns to fill up the duration
    while( duration > 0 )
      {
      // Get a drum pattern, if any

      DrumPattern pattern = getPattern(drumPatterns, duration);
      //System.out.println("pattern = " + pattern + ", duration = " + duration);
      // if there's no suitable pattern, play nothing
      if( pattern == null )
        {
        break;
        }

      int patternDuration = pattern.getDuration();
      duration -= patternDuration;

      // we get a Polylist containing drum parts
      
      DrumLine drumline = pattern.applyRules();
      
      //System.out.println("drumline = " + drumline);

      // Each element of the Polylist is a drum part in the form of a MelodyPart
      // so we go through and render each element
      
      for( MelodyPart d: drumline.getParts() )
        {
        d.setSwing(accompanimentSwing);
        Track track = seq.getDrumTrack(d.getInstrument());
        d.makeSwing();
        d.render(seq, ImproVisor.getDrumChannel(), time, track, 0, endLimitIndex);
        }
      
      time += (patternDuration * seq.getResolution()) / BEAT;
      }
    }

  /**
   * Below is a check to decide whether to continue sequencing.
   * It is used in multiple files.
   * Sequencing should continue if either play-to-end was specified
   * or the end of select is reached.
   * In the latter case, is not desired to generate a midi render for the
   * full score, as that would have to be cut off and causes blips in the
   * sound.
   */

  public static int magicFactor = 4;

  public static boolean limitNotReached(long time, int endLimitIndex)
  {
  return true || endLimitIndex == ENDSCORE // i.e. play to end
      || time <= magicFactor*endLimitIndex; // limit not reached
  }

  public static int getMagicFactor()
  {
      return magicFactor;
  }

  /**
   * Using the ChordPattern objects of this Style, sequences a chordline
   * of a specified duration onto the track.
   * @param seq       the Sequence that contains the Track
   * @param track     the Track to put currentChord events on
   * @param time      a long containing the time to start the chordline
   * @param currentChord     a ChordSymbol containing the currentChord currentChord to render
   * @param previousChord a Polylist containing the previous currentChord
   * @param duration  an int containing the duration of the chordline
   * @return a Polylist containing the last currentChord used in the chordline
   */
private Polylist makeChordline(
        MidiSequence seq,
        long time,
        Chord currentChord,
        Polylist previousChord,
        int duration,
        Transposition transposition,
        int endLimitIndex,
        boolean constantBass)
        throws InvalidMidiDataException
  {
    // To trace rendering info:
    //System.out.println("makeChordLine: time = " + time + " duration = "
    //    + duration + " endLimitIndex = " + endLimitIndex);

    // Because we have no data structure to hold multi-voice parts, 
    // we manually render polylists for each currentChord in this method.

    // Select Bank 0 before program change. 
    // Not sure this is correct. Check before releasing!
    
    Track track = seq.getChordTrack();
    
    if( Preferences.getMidiSendBankSelect())
      {
      track.add(MidiSynth.createBankSelectEventMSB(0, time));
      track.add(MidiSynth.createBankSelectEventLSB(0, time));
      }

    track.add(MidiSynth.createProgramChangeEvent(ImproVisor.getChordChannel(),
                                                 chordInstrument, 
                                                 time));

    ChordSymbol symbol = currentChord.getChordSymbol();

    // The while loop is in case one pattern does not fill
    // the required duration. We may need multiple patterns.
    
    boolean beginning = true;
    while( duration > 0 && limitNotReached(time, endLimitIndex) )
      {
        // Get a pattern for this chord.
        // A pattern can contain volume information.
        
        ChordPattern pattern = getChordPattern(chordPatterns, duration);

        ChordPatternVoiced c;
        
        if( pattern == null  || constantBass )
          {
            // if there's no pattern, and we haven't used a previous
            // pattern on this currentChord, then just play the currentChord for the 
            // duration
            //System.out.println("pattern == null case in Style");
              
            if( !beginning )
              {
                break;
              }
            Polylist v = ChordPattern.findVoicing(symbol, previousChord, this);
            MelodyPart dM = new MelodyPart();
            dM.addNote(new Rest(duration));
            duration = 0;
            LinkedList<Polylist> L = new LinkedList<>();
            L.add(v);
            c = new ChordPatternVoiced(L, dM);
          }
        else
          {
            if( beginning )
              {
               // Accommodate possible "pushing" of first currentChord.
               // The amount is given in slots.
               int pushAmount = pattern.getPushAmount();
               int deltaT = pushAmount * seq.getResolution() / BEAT;
               time -= deltaT;
               if( time < 0 )
                  {
                    time = 0;
                    deltaT = 0;
                  }
                
                duration -= (deltaT + pattern.getDuration());
              }
            else
              {
              duration -= pattern.getDuration();
              }
            // we get a polylist containing the chords (each in a polylist)
            // and a "duration melody" which is a MelodyPart representing
            // the durations of each currentChord
            c = pattern.applyRules(symbol, previousChord, this);
            //System.out.println("\nResult of applyRules to " + symbol + ": " + c);
          }
        
        // Uncomment to show how chord patterns are voiced:
        
        // System.out.println("chord " + currentChord.getName() + ": " + c);
        
        // since we can't run the swing algorithm on a Polylist of 
        // NoteSymbols, we can use this "duration melody" which
        // corresponds to the chords in the above Polylist to find
        // the correct swung durations of the notes

        // chords is a list of lists of notes, each outer list representing
        // a chord voicing. Note that volume settings can be amongst these
        // notes.
        
        // durationMelody is the pattern, consisting of rests of various
        // durations.
        
        LinkedList<Polylist> voicings = c.getVoicings();
        MelodyPart durationMelody = c.getDurations();
        
        durationMelody.setSwing(accompanimentSwing);
        durationMelody.makeSwing();
        //System.out.println("duration melody = " + durationMelody);
        Part.PartIterator i = durationMelody.iterator();

        //System.out.println("chord line = " + chords);

        int volume = 127;
        
        //System.out.println("voicings for " + currentChord.getName() + ": " + voicings + ", durationMelody = " + durationMelody);
        for( Polylist voicing: voicings )
          {
          // Note that voicing should be a Polylist, and may contain volume
                    
            Note note = (Note) i.next();      // Note from the "duration melody"
            
           //System.out.println("voicing = " + voicing + ", note = " + note);

            int dur = note.getRhythmValue();  // A single currentChord's duration

            long offTime = time + dur * seq.getResolution() / BEAT;
        
            // render each NoteSymbol in the currentChord
            if( voicing instanceof Polylist )
              {
                Polylist filtered = filterOutVolumes(voicing);
                // Without this qualification, the voicing keyboard 
                // sometimes shows on the bass note. Not sure why yet.
                if( filtered.nonEmpty() )
                  {
                  currentChord.setVoicing(filtered);
                  }
                Polylist L = voicing;
                //System.out.println("bar " + (1 + time/1920) + ": chord = " + currentChord);            
                // All notes in the voicing are rendered at the same start time
                
                Sequence ms = seq.getSequence();
                
                while( L.nonEmpty() )
                  {
                    Object ob = L.first();
                    if( ob instanceof NoteSymbol )
                      {
                      NoteSymbol ns = (NoteSymbol)ob;
                      note = ns.toNote();
                      note.setRhythmValue(dur);
                      note.setVolume(volume);  // note of chord
                      note.render(ms, 
                                  seq.getChordTrack(), 
                                  time, offTime, 
                                  ImproVisor.getChordChannel(), 
                                  transposition.getChordTransposition());
                      }
                    else if( ob instanceof VolumeSymbol )
                      {
                       volume = ((VolumeSymbol)ob).getVolume();
                      }
                    
                    L = L.rest();
                  }

                previousChord = filtered;
              }

            time = offTime;
          }

        beginning = false;
      }

    // Un-comment this to see voicings
    //System.out.println("voicing " + currentChord + " as " + previousChord);

    //System.out.println("MIDI sequence = " + MidiFormatting.prettyFormat(sequence2polylist(seq)));
    return previousChord;
  }


static Polylist filterOutVolumes(Polylist L)
  {
    if( L.isEmpty() )
      {
        return L;
      }
    
    if( L.first() instanceof VolumeSymbol )
      {
        return filterOutVolumes(L.rest());
      }
    
    return filterOutVolumes(L.rest()).cons(L.first());
  }

  /**
   * Using the BassPattern objects of this Style, sequences a bassline
   * of a specified duration onto the track.
   * 
   * This method is called only once, from render in this same class.
   * 
   * @param bassline  a LinkedList of NoteSymbols making up the bassline so far
   * @param chord     a ChordSymbol containing the currentChord chord to render
   * @param nextChord a ChordSymbol containing the next chord
   * @param previousBassNote  a NoteSymbol containing the previous note
   * @param duration  an int containing the duration of the bassline
   * @return a Polylist of NoteSymbols to be sequenced
   */
  private void addToBassline(
          LinkedList<MelodySymbol> bassline,
          ChordSymbol chord, 
          ChordSymbol nextChord,
          NoteSymbol previousNote, 
          int duration,
          int transposition,
          boolean constantBass)
          throws InvalidMidiDataException
    {
    //System.out.println("addToBassline " + chord);
    while( duration > 0 )
      {
      BassPattern pattern = getPattern(bassPatterns, duration);
//System.out.println("makeBassLine pattern = " + pattern + ", duration = " + duration);

      // If there is no pattern, or we want to play the chord with the voicings 
      // of the current style, but without a bass pattern, as in the case
      // of stepping through chord voicings, 
      // setting constantBass to true bypasses the pattern
      // and just plays one base note, in midi range 48-59 (octave -1)
      
      if( pattern == null || constantBass )
        {
        PitchClass bassPitchClass = chord.getBass();
        int octave = -1; //See NoteSymbol for explanation
        NoteSymbol bassNote = new NoteSymbol(bassPitchClass, octave, duration);
        //System.out.println("bassNote = " + bassNote);
        if( constantBass )
          {
            bassline.add(bassNote);
          }
        break;
        }

      duration -= pattern.getDuration();

      // we get a Polylist of NoteSymbols back from the applyRules 
      // function
      LinkedList<Object> basslineSegment = duration > 0?
                              pattern.applyRules(chord, chord, previousNote)
                            : pattern.applyRules(chord, nextChord, previousNote);

      // System.out.println("basslineSegment = " + basslineSegment);

      // Find the last non-rest in the segment.
      
      Iterator<Object> it = basslineSegment.descendingIterator();
      while( it.hasNext() )
        {
           Object ob = it.next();
           if( ob instanceof NoteSymbol )
             {
               NoteSymbol ns = (NoteSymbol)ob;
               if( !ns.isRest() )
                 {
                   previousNote = ns;
                   break;
                 }
             }
        }
      
      // What does this do?
      
      if( !bassline.isEmpty() )
        {
        Object lastOb = bassline.getLast();
        if( lastOb instanceof Polylist && basslineSegment.getFirst() instanceof NoteSymbol )
          {
          //System.out.println("mystery code on bassline " + bassline);
            Polylist L = (Polylist)lastOb;
            String dur = (String)L.first();
            bassline.removeLast();
            NoteSymbol ns = (NoteSymbol)basslineSegment.getFirst();
            int pDur = Duration.getDuration0(dur) + ns.toNote().getRhythmValue();
            ns = new NoteSymbol(ns.getPitchClass(), ns.getOctave(), pDur, ns.getVolume());
            basslineSegment.set(0, ns);
          }
        }
      //System.out.println("new basslineSegment = " + basslineSegment);

      for( Object ob: basslineSegment )
        {
          bassline.add((MelodySymbol)ob);
        }
      
      }
    }

private Polylist prepProgList(Polylist results, Polylist acc) {
    //extract the chords and interpolations from results in order
    if (results.isEmpty()) return acc;
    return prepProgList(results.rest(), acc.append((Polylist)results.first()));
}

//depending on the boolean lists from willInterplate, map adds a PC
//to the chord part list
private Polylist mapPC(Polylist results) {
    if (results.isEmpty()) {
        return Polylist.nil;
    }
   if(results.rest().isEmpty()) {
       return mapPC(results.rest()).cons(((Polylist)results.first()).allButLast());
   }
   
   Chord leftbound = (Chord)((Polylist)results.first()).first();
   Chord rightbound = (Chord)((Polylist)results.second()).first();
   boolean action = (boolean)((Polylist)((Polylist)results.first()).last()).first();
   //System.out.println("leftbound: " + leftbound + " rightbound: " + rightbound + " action: " + action);
   
   if (action){
       Polylist newFirst = getPC(rightbound, leftbound);
       Polylist newRight = Polylist.list(newFirst.last(), ((Polylist)results.second()).last());
       newFirst = newFirst.allButLast();
       return mapPC(results.rest().rest().cons(newRight)).cons(newFirst);
   }
   
   return mapPC(results.rest()).cons(((Polylist)results.first()).allButLast());
       
}

 /* find the appropriate passing chord given a target chord*/
  private Polylist getPC(Chord c, Chord prev) {
     Polylist pchords = Polylist.nil;
     double sum = 0;
     String root = "";
     
     if (interpolations.isEmpty())
     {
         return Polylist.list(prev,c);
     }
     for (Polylist P = interpolations; P.nonEmpty(); P = P.rest()) 
     {
        Interpolant pc = null; 
        Interpolant first = (Interpolant)P.first();
        Polylist target = Polylist.list(first.getCHORDS().first(),first.getCHORDS().last());
        //the representive quality for the right boundary
        String targetright = "";
        //representative quality for the left boundary
        String targetleft;
        String rootleft;
        int targetsdistance = 0;
        
        //searches for wildchords
         if (target.member("_")) {
             rootleft = null;
             targetleft = null;
             if (((String) target.first()).equals("_")) {
                 Polylist right = getTargetAndRoot((String)target.last());
                 targetright = (String)right.first();
                 root = (String)right.last();
             }

             if (((String) target.last()).equals("_")) {
                 Polylist right = getTargetAndRoot((String)target.first());
                 targetright = (String)right.first();
                 root = (String)right.last();
             }
         }
         else {
           //if both boundary chords are defined in a interpolant
           //this gets the representative quality and root for each one
           
            Polylist left = getTargetAndRoot((String)target.first());
            Polylist right = getTargetAndRoot((String)target.last());
             targetright = (String)right.first();
             targetleft = (String)left.first();
             
             rootleft =  ((String)left.last());
             root  = ((String)right.last());
             targetsdistance = PitchClass.findRise(rootleft, root);
         }
        Chord leftchord = null;
       //checks the interpolant with the boundary chords to determine if it
       //matches the criteria to be a valid interpolation
        switch (c.getFamily()) {
            case "augmented":
            case "major":
                if (rootleft != null) {
                    if (targetleft != null) {
                        leftchord = new Chord(rootleft.toUpperCase() + targetleft);
                    }
                    if ((targetright.equals("") && targetleft != null)
                            || targetright.equals("") && 
                            prev.getFamily().equals(leftchord.getFamily())
                            && (targetsdistance == PitchClass.findRise(
                                    prev.getRoot(),c.getRoot()))) 
                    {
                        
                        pc = (Interpolant) P.first();
                    }
                } else if (targetright.equals("")) {
     
                    pc = (Interpolant) P.first();
                }
                break;
            case "half-diminished":
            case "minor7":
            case "minor": 
                if (rootleft != null) {
                    if (targetleft != null) {
                        leftchord = new Chord(rootleft.toUpperCase() + targetleft);
                    }
                    if (targetright.equals("m") && targetleft != null) {
                            if (prev.getFamily().equals(leftchord.getFamily())
                                && (targetsdistance == PitchClass.findRise(
                                        prev.getRoot(), c.getRoot()))) {
 
                        pc = (Interpolant) P.first();
                    }
                    }
                } else if (targetright.equals("m")) {

                    pc = (Interpolant) P.first();
                }
                break;
            case "sus4":
            case "dominant":
                if (rootleft != null) {
                    if (targetleft != null) {
                        leftchord = new Chord(rootleft.toUpperCase() + targetleft);
                    }
                    if (targetright.equals("7") || targetright.equals("7+") && targetleft != null) {
                        if (prev.getFamily().equals(leftchord.getFamily())
                                && (targetsdistance == PitchClass.findRise(
                                        prev.getRoot(), c.getRoot()))) {
                            if (targetright.equals("7")) {
                                pc = (Interpolant) P.first();
                            } else if (targetright.equals("7+")) {

                                pc = (Interpolant) P.first();
                            }
                        }
                    }
                } else if (targetright.equals("7")) {

                    pc = (Interpolant) P.first();
                } else if (targetright.equals("7+")) {

                    pc = (Interpolant) P.first();
                }
                break;
            default: break;
        }

          if (pc != null) {
              pchords = pchords.cons(pc);
              sum+= pc.getWEIGHT();
          }
      }

   int transposition = PitchClass.findRise(root, c.getRoot());
   //System.out.println(" left: " + prev + " right: " + c +" \n pchords "+ pchords + "\n");
  
  //sends the list of passing chords to choosePC for 1 to be chosen, along
  //with transposition and given the correct durations to each chord
  if(pchords.nonEmpty())
  {
   pchords = choosePC(pchords, prev, c, sum, transposition);
  }
  else pchords = Polylist.list(prev,c);
   
    return pchords;
  }
  
  private Polylist getTargetAndRoot(String target) {
      Chord c = new Chord(target);
      String t = "";
      String r = c.getRoot();
      String family = c.getFamily();
      switch (family) {
          case "major":
          case "augmented":
              break;
          case "minor":
          case "minor7":
          case "half-diminished":
              t = "m";
              break;
          case "dominant":
              String quality = c.getQuality();
              if (quality.contains("+") || quality.contains("#") ||
                      quality.contains("b9") || quality.contains("alt")) {
                  t = "7+";
      }
              else t = "7";
              break;
          default:
              t = "7";
              break;
      }

      return Polylist.list(t,r);
  }
  
  private Polylist choosePC(Polylist plist, Chord leftbound, 
          Chord rightbound, double sum, int transposition) {
    
    Chord pc;
    Interpolant chosen;
    //choose one interpolant by the list by weight
          double random = gen.nextDouble();

          double weights = 0;
          chosen = (Interpolant) plist.first();
          for (Polylist P = plist; P.nonEmpty(); P = P.rest()) {
              if ((int)sum == 1) { 
              weights += ((Interpolant) P.first()).getWEIGHT();
              }
              else weights += ((Interpolant) P.first()).getWEIGHT()/2;
              
              if (random < weights) {
                  chosen = (Interpolant) P.first();
                  break;
              }
          }
    int rhythmValue;
      
    Polylist targets = Polylist.list(chosen.getCHORDS().first(),
            chosen.getCHORDS().last());
    Polylist chords = chosen.getCHORDS().rest().allButLast();
    //searches for wild chord interpolations with only one insertion
    if(targets.member("_") && chords.length() == 1)
    {
        pc = new Chord((String)chords.first());
        pc.transpose(transposition);
        if (((String) targets.first()).equals("_")) {
            int leftRhythmVal = leftbound.getRhythmValue();
            int dividor = chosen.getDivide().length() - 2;
            if (leftRhythmVal / dividor >= chosen.getMINSLOTS()) {
                rhythmValue = leftbound.getRhythmValue() / dividor;
                leftbound.setRhythmValue(leftRhythmVal - rhythmValue);
                pc.setRhythmValue(rhythmValue);
            } else {
                return Polylist.list(leftbound, rightbound);
            }

        } else if (((String) targets.last()).equals("_")) {
            if (rightbound.getRhythmValue() / 2 >= chosen.getMINSLOTS()) {
                rhythmValue = rightbound.getRhythmValue() / 2;
                rightbound.setRhythmValue(rhythmValue);
                pc.setRhythmValue(rhythmValue);
            } else {
                return Polylist.list(leftbound, rightbound);
            }
        }
    }
    //sends chords with multiple chord insertions to be given the right durations
    else return chooseMultiPC(leftbound,chosen,rightbound, transposition); 
       //System.out.println("left: " + leftbound + " pc: " + pc + " rightbound: " + rightbound);
       return Polylist.list(leftbound,pc,rightbound);
  }
  
    private Polylist chooseMultiPC(Chord leftbound, Interpolant interp, Chord rightbound,
        int transposition) {
        
        Polylist targets = Polylist.list(interp.getCHORDS().first(),
                interp.getCHORDS().last());
        Polylist chords = interp.getCHORDS().rest().allButLast();
        Polylist result = Polylist.nil;
        
        if(targets.member("_")) {
            if (((String)targets.first()).equals("_"))
            {
                if (leftbound.getRhythmValue() % (1+chords.length()) != 0
                        || leftbound.getRhythmValue()/(1 + chords.length()) < interp.getMINSLOTS())
                {
                    return Polylist.list(leftbound,rightbound);
                }
                
                int rhythmValue = leftbound.getRhythmValue() / (1+chords.length());
                leftbound.setRhythmValue(rhythmValue);
                result = result.cons(leftbound);
                for(Polylist P = chords; P.nonEmpty(); P = P.rest()) {
                    Chord pc = new Chord((String)P.first());
                    pc.setRhythmValue(rhythmValue);
                    pc.transpose(transposition);
                    result = result.append(Polylist.list(pc));
                }
               return result.append(Polylist.list(rightbound));
              
            }
            else if (((String)targets.last()).equals("_"))
            {
                if (rightbound.getRhythmValue() % (1+chords.length()) != 0
                        || rightbound.getRhythmValue()/(1+chords.length()) < interp.getMINSLOTS())
                {
                    return Polylist.list(leftbound,rightbound);
                }
                
                int rhythmValue = rightbound.getRhythmValue() / (1+chords.length());
                rightbound.setRhythmValue(rhythmValue);
                result = result.cons(leftbound);
                for(Polylist P = chords; P.nonEmpty(); P = P.rest()) {
                    Chord pc = new Chord((String)P.first());
                    pc.setRhythmValue(rhythmValue);
                    pc.transpose(transposition);
                    result = result.append(Polylist.list(pc));
                }
               return result.append(Polylist.list(rightbound));
            }
        }
        int totalSpace = rightbound.getRhythmValue() + leftbound.getRhythmValue();
        int totalchordslength = chords.length() + 2;
        if(totalSpace % totalchordslength != 0 ||
                totalSpace / totalchordslength < interp.getMINSLOTS())
        {
            return Polylist.list(leftbound,rightbound);
        }
        int rhythmValue = totalSpace/ totalchordslength;
        leftbound.setRhythmValue(rhythmValue);
        result = result.cons(leftbound);
        
        for(Polylist P = chords; P.nonEmpty(); P = P.rest()) {
            Chord pc = new Chord((String)P.first());
            pc.setRhythmValue(rhythmValue);
            pc.transpose(transposition);
            result = result.append(Polylist.list(pc));
        }
        
        rightbound.setRhythmValue(rhythmValue);
        return result.append(Polylist.list(rightbound));
    }
  
    private Polylist substituteChords(Polylist original)
    {
        if (original.isEmpty())
        {
            return original;
        }
        Chord first = (Chord)original.first();
        Polylist sublist;
      //   first.getChordForm().getSubstitutions();
        for(Polylist P = substitutions; P.nonEmpty(); P = P.rest())
        {
            //match and check qualifications of a given sub
            Chord subchord = first;
            Substitution sub = (Substitution)P.first();
            String str =(String)sub.getOriginals().first();
            if(!str.contains("_")) {
                
             subchord = new Chord(str);
            if (!subchord.getQuality().equals(first.getQuality()))
                    continue;
            
            int random = (int)(Math.random()*100+1);
            if (random > (int)(sub.getWeight()*100))
                continue;
            
            //get a sublist of thats the same length of the original chords
           //specified in the Substitution
            int length = sub.getOriginals().length();
            Polylist cutList = original.prefix(length);
            
            //makes sure the list of that length is actually in the original
           //chordlist
           if(cutList.isEmpty())
               continue;
           
           //checks the sub chords
           sublist = checkSubChords(cutList, sub);       
           if(sublist.length() != length) 
               continue;
           
           //transposes, sets duration, and returns the correct substitution
           //chords
           int transposition = PitchClass.findRise(
                   subchord.getRoot(), first.getRoot());
           sublist = setSubChords(cutList, sub, transposition);
          
           return substituteChords(original.coprefix(length)).cons(sublist);
           
           
            } else {
            
            int random = (int)(Math.random()*100+1);
            if (random > (int)(sub.getWeight()*100))
                continue;
            
            Polylist possubs = first.getChordForm().getSubstitutions();
            //System.out.println("possubs " + possubs);
                if (possubs.nonEmpty()) {
                    int randindex = gen.nextInt(possubs.length());
                    String sym = (String) possubs.nth(randindex);
                    Chord nchord = new Chord(sym);
                   // System.out.println("nchord " + nchord);
                    nchord.setRhythmValue(first.getRhythmValue());
                   // System.out.println("used system vocal single chord sub");
                    return substituteChords(original.rest()).cons(nchord);
                }
            }
        }
        
        return substituteChords(original.rest()).cons(first);
    }
    
    private Polylist checkSubChords(Polylist sublist, Substitution sub) {
            Polylist subchords = sub.getOriginals();
            Chord firstchord = new Chord((String)subchords.first());
            
            Polylist checker = Polylist.list(firstchord);
            subchords = subchords.rest();
            //makes sure every chord in the sublist matches with
            //every chord specified in the Subsitution
            for(Polylist L = sublist.rest(); L.nonEmpty(); L = L.rest())
            {   
                Chord checkchord = new Chord((String)subchords.first());
                if(checkchord.getQuality().equals(((Chord)L.first()).getQuality()))
                {
                    checker = checker.append(Polylist.list(L.first()));
                } else return checker;
                subchords = subchords.rest();
            }
            
            return checker;
    }
    
    private Polylist setSubChords(Polylist sublist, Substitution sub, 
            int transposition) {
        int totalSpace = 0;
        //find the total musical space that can be used for the substitution
        for (Polylist P = sublist; P.nonEmpty(); P = P.rest())
        {
            totalSpace+= ((Chord)P.first()).getRhythmValue();
        }
        //System.out.println("sublist: " + sublist +  " totalspace is: " + totalSpace);
        int rhythmValue = totalSpace / sub.getSubs().length();
        //divide the total space evenly amound the substitutions and check to 
        //make sure that the given rhythm values aren't triplet
        //values
        //Duration.
        
        if (rhythmValue < sub.getMinSlots() || (rhythmValue % 120 != 0)
                || (rhythmValue*(480 / sub.getMinSlots()) % 480 != 0))
        {
            
            return sublist;
        }
        Polylist chordList = Polylist.nil;
        
        for(Polylist L = sub.getSubs(); L.nonEmpty(); L = L.rest())
        {
            Chord newChord = new Chord((String)L.first());
            newChord.setRhythmValue(rhythmValue);
            newChord.transpose(transposition);
            chordList = chordList.append(Polylist.list(newChord));
        }
        
        return chordList;
    }
    
    private Polylist extractSub(Polylist original, Polylist acc)
    {
        //take the substitutions out of their polylists to
        //return a polylist of chords
        if (original.isEmpty())
        {
            return acc;
        }
        
        if(original.first() instanceof Polylist)
        {
            return extractSub(original.rest(),
                    acc.reverse().append((Polylist)original.first()).reverse());
        }
        
        return extractSub(original.rest(),acc.cons(original.first()));
    }
  
    private ChordPart createInterpolatedChordPart(ChordPart partA) {
        if (interpolations.isEmpty() && substitutions.isEmpty()) {
            return partA;
        }
        ChordPart part = partA.copy();
        part.setRoadmap(partA.getRoadMap());
        part.setSectionInfo(partA.getSectionInfo()); // Seems like this shouldn't be necessary, but apparently is.
        Polylist sectionInfo = Interpolate.ArraytoPoly(part.getSectionInfo().getSectionRecords());

        //returns a polylist of paired chords and boolean polylists 
        //that tells where each interpolant will fall
        Polylist results = Polylist.nil;
        if (interpolations.nonEmpty()) {
            results = Interpolate.willInterpolate(
                part, 0, ((Interpolant) interpolations.first()).getMINSLOTS(),
                ((Interpolable) interpolables.first()).getPROBABILITY());        
            //System.out.println("1 " + results);

        } else {
            results = Interpolate.willInterpolate(
                    part, 0, ((Substitution) substitutions.first()).getMinSlots(),
                    ((Interpolable) interpolables.first()).getPROBABILITY());
       
        }
        //insert interpolations
        results = mapPC(results);
        results = prepProgList(results, Polylist.nil);
        //insert substitutions
        results = extractSub(substituteChords(results), Polylist.nil).reverse();
        
        ChordPart newChordPart = new ChordPart();
        //place these chords into a ChordPart
        for (Polylist P = results; P.nonEmpty(); P = P.rest()) {
            Chord chord = (Chord) P.first();
            newChordPart.addChord(chord.getName(), chord.getRhythmValue());
        }

        //insert the section info from the original chordPart into the new chordPart
        newChordPart.setSectionInfo(partA.getSectionInfo());
        for (Polylist L = sectionInfo; L.nonEmpty(); L = L.rest()) {
            SectionRecord first = (SectionRecord) L.first(); // L was sectionInfo
            newChordPart.addSection(first.styleName, first.index, first.isPhrase);
        }

        return newChordPart;
    }
  
  
/**
 * This is called from SectionInfo.
 * 
 * Using the Pattern objects of this Style, sequences an accompaniment for the
 * given ChordPart.
 *
 * @param seq the Sequence that contains the Track
 * @param track the Track to put the accompaniment on
 * @param time a long containing the time to start the accompaniment
 * @param chordPart the ChordPart to render
 * @return a long containing the ending time of the accompaniment
 */
  
public long render(MidiSequence seq, // called from SectionInfo
                   long time,
                   ChordPart chordPart,
                   int startIndex,
                   int endIndex,
                   Transposition transposition,
                   boolean useDrums,
                   int endLimitIndex,
                   boolean constantBass)
        throws InvalidMidiDataException
  {
    int chordTransposition = transposition.getChordTransposition();
    int bassTransposition = transposition.getBassTransposition();
    setResidualChordPattern(null);
    boolean hasStyle = !noStyle();
    // to trace sequencing info:
    //System.out.println("Sequencing Style: " + this + " startIndex = " + startIndex
    // + " endIndex = " + endIndex + " endLimitIndex = " + endLimitIndex + " useDrums = " + useDrums + " hasStyle = " + hasStyle);
    // i iterates over the Chords in the ChordPart.
    ChordPart chordPart2 = createInterpolatedChordPart(chordPart);
    //System.out.println("\n chord part is: \n" + chordPart);
    //System.out.println("\nintrpolated chord part is: \n" + chordPart2);
    
   // imp.data.Score newScore = new imp.data.Score(chordPart2.size());

   // newScore.setChordProg(chordPart2);
   // newScore.setSectionInfo(chordPart2.getSectionInfo());
   // imp.gui.Notate newNotate = new imp.gui.Notate(newScore);
   // newNotate.setVisible(true);
   chordPart = chordPart2;
    
    Part.PartIterator i =
            chordPart.iterator(chordPart.getCurrentChordIndex(startIndex));

    long startTime = time;

    if( hasStyle && useDrums && !drumPatterns.isEmpty() )
      {
        // Introduce drums, if there is a Style

        makeDrumline(seq, startTime, endIndex - startIndex, endLimitIndex);
      }

    Chord next = null;
    Chord prev = null;

    LinkedList<MelodySymbol> bassline = new LinkedList<>();

    int index = startIndex;
    ChordSymbol chord;
    ChordSymbol nextChord;
    ChordSymbol previousExtension = null;
    NoteSymbol previousBassNote = 
        NoteSymbol.makeNoteSymbol((bassHigh.getMIDI() + bassLow.getMIDI()) / 2);
    Polylist previousChord = Polylist.nil;

    // Iterating over one ChordPart with i

    while( (i.hasNext() || next != null) 
        && (endLimitIndex == ENDSCORE || index <= endLimitIndex) )
      {
        if( next == null )
          {
            index = i.nextIndex();
            next = (Chord) i.next();
          }

        Chord currentChord = next;

        int rhythmValue = currentChord.getRhythmValue();
        if( startIndex > index )
          {
            rhythmValue -= startIndex - index;
          }

        if( i.hasNext() )
          {
            index = i.nextIndex();

            next = (Chord) i.next();
          }
        else
          {
            next = null;
            index = chordPart.size();
          }

        if( endIndex <= index )
          {
            rhythmValue -= index - endIndex;
          }

        if( !hasStyle )
          {
            time = currentChord.render(seq,
                                       time,
                                       ImproVisor.getChordChannel(),
                                       this,
                                       prev,
                                       rhythmValue,
                                       chordTransposition,
                                       endLimitIndex);
            prev = currentChord;
            if( endIndex <= index )
              {
                break;
              }
            else
              {
                continue;
              }
          }

        chord = currentChord.getChordSymbol();
        if( next == null || next.getChordSymbol().isNOCHORD() )
          {
            nextChord = chord;
          }
        else
          {
            nextChord = next.getChordSymbol();
          }

        if( !chord.isNOCHORD() && hasStyle )
          {
            if( useExtensions )
              {
                if( gen.nextInt(3) == 0 )
                  {
                    chord = extend(chord, previousExtension);
                  }
                previousExtension = chord;
              }

            //System.out.println("current chord " + currentChord.getName() + " and index " + index);
            previousChord = makeChordline(seq,
                                          time,
                                          currentChord,
                                          previousChord,
                                          rhythmValue, //currentChord.getRhythmValue(),
                                          transposition,
                                          endLimitIndex,
                                          constantBass);
          }
        
        if( !constantBass )
        {
        //System.out.println("previousBassNote " + previousBassNote + " low = " + getBassLow() + " high = " + getBassHigh());
        // adjust bass octave between patterns only, not within
        if( previousBassNote.higher(getBassHigh()) )
          {
            previousBassNote = previousBassNote.transpose(-12);
            //System.out.println("downward to " + previousBassNote);
          }
        else if( getBassLow().higher(previousBassNote) )
          {
            previousBassNote = previousBassNote.transpose(12);
            //System.out.println("upward to " + previousBassNote);
          }
        }
        
//System.out.println("\nAbout to add to bassline, chord = " + chord + ", hasStyle = " + hasStyle);
        if( !chord.isNOCHORD() && hasStyle )
          {
            addToBassline(bassline,
                        chord,
                        nextChord,
                        previousBassNote,
                        rhythmValue,
                        bassTransposition,
                        constantBass);

            // Sets previousBassNote to last NoteSymbol in bassline
 
            for( Iterator<MelodySymbol> it = bassline.descendingIterator(); it.hasNext(); )
              {
                MelodySymbol ob = it.next();
                if( ob instanceof NoteSymbol )
                  {
                    NoteSymbol ns = (NoteSymbol)ob;
                    
                    if( !ns.isRest() )
                      {
                      previousBassNote = ns;
                      break;
                      }
                  }
              }
          }
        else
          {
            Rest r = new Rest(rhythmValue);
            NoteSymbol rest = NoteSymbol.makeNoteSymbol(r.toLeadsheet());
            bassline.add(rest);
          }

        time += rhythmValue /*currentChord.getRhythmValue()*/ * seq.getResolution() / BEAT;
        
        if( endIndex <= index )
          {
            break;
          }
      }
    //System.out.println("bassline = " + bassline);
    
    // Finished iterating over ChordPart
    
    if( !bassline.isEmpty() )
      {
        MelodyPart bassMelody = new MelodyPart();

        Object last = bassline.getLast();

        if( last instanceof Polylist )
          {
            Polylist L = (Polylist) last;
            NoteSymbol ns = (NoteSymbol) L.second();
            bassline.removeLast();
            bassline.add(ns);
          }

        int volume = MAX_VOLUME;

        // add each note to our bassline melody
        for( Object ob: bassline )
          {
            if( ob instanceof NoteSymbol )
              {
                NoteSymbol noteSymbol = (NoteSymbol) ob;
                Note note = noteSymbol.toNote();
                note.setVolume(volume);
                bassMelody.addNote(note);
              }
            else if( ob instanceof VolumeSymbol )
              {
                VolumeSymbol volumeSymbol = (VolumeSymbol) ob;
                volume = volumeSymbol.getVolume();
                //System.out.println("setting bassMelodyVolume to " + volumeSymbol);
              }
            else
              {
                assert false;
              }
          }

        bassMelody.setSwing(accompanimentSwing);
        bassMelody.setInstrument(bassInstrument);
        bassMelody.makeSwing();
        bassMelody.render(seq,
                          ImproVisor.getBassChannel(),
                          startTime,
                          seq.getBassTrack(),
                          bassTransposition,
                          endLimitIndex);
      }

    return time;
  }

  /**
   * Extend the currentChord chord based on a previous chord.
   * @param chord     a ChordSymbol containing the chord to extend
   * @param previousChord a ChordSymbol containing the previous chord
   * @return a ChordSymbol containing the extended chord
   */
  public static ChordSymbol extend(ChordSymbol chord, ChordSymbol lastChord)
    {
    int rise = PitchClass.findRise(chord.getRootString());
    Polylist extensions;

    // get a random extension if there is no previous chord
    if( lastChord == null )
      {
      extensions = chord.getChordForm().getExtensions();
      extensions = ChordSymbol.chordSymbolsFromStrings(extensions);
      extensions = ChordSymbol.transpose(extensions, rise);
      extensions = extensions.cons(chord);

      return (ChordSymbol)BassPattern.getRandomItem(extensions);
      }

    extensions = Advisor.getExtensions(Advisor.getFinalName(
            chord.toString()));
    extensions = ChordSymbol.chordSymbolsFromStrings(extensions);
    extensions = ChordSymbol.transpose(extensions, rise);
    extensions = extensions.cons(chord);

    // check for appropriate extensions based on previous chord
    Polylist goodExtensions = Polylist.nil;
    int highCommon = -20;
    while( extensions.nonEmpty() )
      {
      ChordSymbol c = (ChordSymbol)extensions.first();
      extensions = extensions.rest();
          int common = commonPitches(lastChord, c) -
              uncommonPitches(lastChord, c);

      if( common == highCommon )
        {
        goodExtensions = goodExtensions.cons(c);
        }
      else if( common > highCommon )
        {
        highCommon = common;
        goodExtensions = Polylist.list(c);
        }
      }

    return (ChordSymbol)BassPattern.getRandomItem(goodExtensions);
    }

  /**
   * Takes two chords and returns the number of pitches the second one
   * has that the first one doesn't.
   * @param c1        a ChordSymbol to compare
   * @param c2        a chordSymbol to compare
   * @return an int containing the number of pitches the second chord
   *         has that the first one doesn't
   */
  public static int uncommonPitches(ChordSymbol c1, ChordSymbol c2)
    {
    Polylist s1 = c1.getChordForm().getSpell(c1.getRootString());
    Polylist s2 = c2.getChordForm().getSpell(c2.getRootString());
    
    int sum = 0;
    while( s2.nonEmpty() )
      {
      NoteSymbol n = (NoteSymbol)s2.first();
      s2 = s2.rest();

      if( !n.enhMember(s1) )
        {
        sum++;
        }

      }
    return sum;
    }

  /**
   * Returns the number of pitches two chords have in common.
   * @param c1        a ChordSymbol to compare
   * @param c2        a ChordSymbol to compare
   * @return an int containing the number of pitches the two chords have
   *         in common
   */
  public static int commonPitches(ChordSymbol c1, ChordSymbol c2)
    {
    Polylist s1 = c1.getChordForm().getSpell(c1.getRootString());
    Polylist s2 = c2.getChordForm().getSpell(c2.getRootString());

    int sum = 0;
    while( s2.nonEmpty() )
      {
      NoteSymbol n = (NoteSymbol)s2.first();
      s2 = s2.rest();

      if( n.enhMember(s1) )
        {
        sum++;
        }

      }
    return sum;
    }

    @Override
    public boolean equals(Object obj)
      {
        if( obj == null )
          {
            return false;
          }
        if( getClass() != obj.getClass() )
          {
            return false;
          }
        final Style other = (Style) obj;
        if( (name == null && other.name != null) || !name.equals(other.name) )
          {
            return false;
          }
        return true;
      }

    @Override
    public int hashCode()
      {
        int hash = 5;
        hash = 29 * hash + (this.name != null ? this.name.hashCode() : 0);
        return hash;
      }

  }

```

### File: src\imp\style\StyleMixer.java

```java

/**
 * This Java Class is part of the Impro-Visor Application
 *
 * Copyright (C) 2005-2012 Robert Keller and Harvey Mudd College
 *
 * Impro-Visor is free software; you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation; either version 2 of the License, or (at your option) any later
 * version.
 *
 * Impro-Visor is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of merchantability or fitness
 * for a particular purpose. See the GNU General Public License for more
 * details.
 *
 * You should have received a copy of the GNU General Public License along with
 * Impro-Visor; if not, write to the Free Software Foundation, Inc., 51 Franklin
 * St, Fifth Floor, Boston, MA 02110-1301 USA
 */

package imp.style;

import imp.style.stylePatterns.DrumRuleDisplay;
import imp.style.stylePatterns.PatternDisplay;
import imp.style.stylePatterns.ChordPatternDisplay;
import imp.style.stylePatterns.BassPatternDisplay;
import imp.midi.MIDIBeast;
import imp.style.stylePatterns.BassPattern;
import imp.style.stylePatterns.DrumPattern;
import imp.style.stylePatterns.DrumRuleRep;
import imp.style.stylePatterns.ChordPattern;
import imp.Constants;
import imp.ImproVisor;
import imp.com.OpenLeadsheetCommand;
import imp.com.PlayScoreCommand;
import imp.data.*;
import imp.gui.Notate;
import imp.gui.WindowMenuItem;
import imp.gui.WindowRegistry;
import imp.util.ErrorLog;
import imp.util.LeadsheetFileView;
import imp.util.StyleFilter;
import java.awt.Color;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileWriter;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.Set;
import java.util.Iterator;
import javax.swing.JFileChooser;
import javax.swing.table.DefaultTableModel;
import javax.swing.SpinnerModel;
import javax.swing.SpinnerNumberModel;
import javax.swing.JTable;
import polya.Polylist;
import polya.PolylistBuffer;
import polya.Tokenizer;


/**
 * @author Robert Keller, Caitlin Chen
 * 
 * Use of public access to elements in MIDIBeast should
 * be changed to use proper methods.
 */

@SuppressWarnings("serial")

public class StyleMixer extends javax.swing.JDialog implements Constants
{
/**
 * name used in drum rules
 */
public static final String DRUM_SYMBOL = "drum";

Notate notate;
StyleEditor styleEditor;


/**
 * minimum duration (in slots) for a note not to be counted as a rest.
 */
private int minDuration = 0;


public static final int BASS = 0;
public static final int DRUM = 1;
public static final int CHORD = 2;

public static final Color BASS_COLOR = Color.orange;
public static final Color CHORD_COLOR = Color.green;
public static final Color DRUM_COLOR = Color.yellow;

public static final Boolean USE_TRUE = true;
public static final Boolean USE_FALSE = false;

public static final int USE = 0;
public static final int STYLE = 1;
public static final int NAME = 2;
public static final int PATTERN = 3;

// Drum colum indices
public static final int DRUM_USE = 0;
public static final int DRUM_STYLE = 1;
public static final int DRUM_PATTERN_NAME = 2;
public static final int DRUM_NAME = 3;
public static final int DRUM_RULE = 4;

/**
 * stuff for the pattern tables
 */
String[] columnHeaders = new String[]
    {
        "Use", "Style", "Name", "Pattern"
    };

String[] drumColumnHeaders = new String[]
    {
        "Use", "Style", "Pattern Name", "Rule Name", "Rule"
    };

private BassTableModel bassTableModel = 
        new BassTableModel(columnHeaders, ROW_COUNT);

private ChordTableModel chordTableModel =
        new ChordTableModel(columnHeaders, ROW_COUNT);

private DrumTableModel drumTableModel =
        new DrumTableModel(drumColumnHeaders, DRUM_ROW_COUNT);

public static final int ROW_COUNT = 200;

public static final int DRUM_ROW_COUNT = 400;

// Used to load styles into the mixer
private JFileChooser openStyle = new JFileChooser();

private File savedStyle = null;

private File styleDir;

// Hash Maps hold all the patterns that are loaded into the mixer
private LinkedHashMap<String, String> bassRules =
        new LinkedHashMap<String, String>();

private LinkedHashMap<String, String> chordRules =
        new LinkedHashMap<String, String>();

private LinkedHashMap<String, String> drumRules =
        new LinkedHashMap<String, String>();

private LinkedHashMap<String, ArrayList<DrumRuleRep>> drumPatterns = 
        new LinkedHashMap<String, ArrayList<DrumRuleRep>>();

private LinkedHashMap<DrumRuleRep, Integer> ruleIndex = 
        new LinkedHashMap<DrumRuleRep, Integer>();

private ArrayList<String> bassPatternNames = new ArrayList<String>();
private ArrayList<String> chordPatternNames = new ArrayList<String>();

private ArrayList<String> drumRuleNames = new ArrayList<String>();
private ArrayList<String> drumPatternNames = new ArrayList<String>();


/**
 * Creates new form ExtractionEditor
 */

public StyleMixer(java.awt.Frame parent, 
                        boolean modal, 
                        StyleEditor p)
  {
    super(parent, modal);
    this.styleEditor = p;
    this.notate = p.getNotate();
    
    initComponents();
    
    bassTable.setModel(bassTableModel);
    chordTable.setModel(chordTableModel);
    drumTable.setModel(drumTableModel);
    
    styleDir = ImproVisor.getStyleDirectory();

    initComponents2();
    setSize(900, 425);

    //SpinnerModel model = new SpinnerNumberModel(1, 1, 100, 1);
    //loadStyleMixerPatterns();
  }

public class BassTableModel extends DefaultTableModel
{
    private static final int columnCount = 4;
    
    boolean[] canEdit = new boolean[]
    {
      //use,  style, name, pattern
        true, false, true, true
    }; 
    
    
    public BassTableModel(String[] headers, int rows)
    {
        super(headers, rows);
    }
    
    @Override
    public boolean isCellEditable(int rowIndex, int columnIndex) 
    {
        return canEdit [columnIndex];
    }
    
    @Override
    public Class<?> getColumnClass(int column)
    {
        if( column == USE )
        {
            return Boolean.class;
        }
        else
        {
            return Object.class;
        }
    }
}

public class ChordTableModel extends DefaultTableModel
{
    private static final int columnCount = 4;
    
    boolean[] canEdit = new boolean[]
    {
      //use,  style, name, pattern
        true, false, true, true
    };
    
    
    public ChordTableModel(String[] columnHeaders, int rows)
    {
        super(columnHeaders, rows);
    }
    
    @Override
    public boolean isCellEditable(int rowIndex, int columnIndex) 
    {
        return canEdit [columnIndex];
    }
    
    @Override
    public Class<?> getColumnClass(int column)
    {
        if( column == USE )
        {
            return Boolean.class;
        }
        else
        {
            return Object.class;
        }
    }
}

public class DrumTableModel extends DefaultTableModel
{
    private static final int columnCount = 5;
    
    boolean[] canEdit = new boolean[]
    {
      //use,  style, name, pattern
        true, false, true, true, true
    };
    
    
    public DrumTableModel(String[] headers, int rows)
    {
        super(headers, rows);
    }
    
    @Override
    public boolean isCellEditable(int rowIndex, int columnIndex) 
    {
        return canEdit [columnIndex];
    }
    
    @Override
    public Class<?> getColumnClass(int column)
    {
        if( column == DRUM_USE )
        {
            return Boolean.class;
        }
        else
        {
            return Object.class;
        }
    }
}

/**
 * Clears the style mixer to allow for new things to be added
 */
public void reset()
{
    bassTableModel = new BassTableModel(columnHeaders, ROW_COUNT);
    chordTableModel = new ChordTableModel(columnHeaders, ROW_COUNT);
    drumTableModel = new DrumTableModel(drumColumnHeaders, DRUM_ROW_COUNT);
    
    bassTable.setModel(bassTableModel);
    chordTable.setModel(chordTableModel);
    drumTable.setModel(drumTableModel);
    
    bassRules = new LinkedHashMap<String, String>();
    chordRules = new LinkedHashMap<String, String>();
    drumRules = new LinkedHashMap<String, String>();
    
    drumPatterns = new LinkedHashMap<String, ArrayList<DrumRuleRep>>();
    drumPatternNames = new ArrayList<String>();
    drumRuleNames = new ArrayList<String>();
    ruleIndex = new LinkedHashMap<DrumRuleRep, Integer>();
}

public StyleEditor newStyleEditor()
{
    StyleEditor m = new StyleEditor(notate);
      m.pack();
      m.setLocationRelativeTo(this);
      m.setLocation(m.getX() + WindowRegistry.defaultXnewWindowStagger, 
                    m.getY() + WindowRegistry.defaultYnewWindowStagger);
      WindowRegistry.registerWindow(m, "New Style");
      m.setVisible(true);
    return m;
}

/*
public void setBass()
  {
    styleMixerPanel.setBackground(Color.orange);
    setBassRawRules();
  }

public void setChords()
  {
    setChordRawRules();
  }

public void setDrums()
  {
    setDrumRawRules();
  }



public void setBassRawRules()
  {
    //rawRulesModelBass.clear();
    //rawRulesJListBass.setModel(rawRulesModelBass);
  }

public void setChordRawRules()
  {
    //rawRulesModelChord.clear();
    //rawRulesJListChord.setModel(rawRulesModelChord);
  }

public void setDrumRawRules()
  {
    //rawRulesModelDrum.clear();    
    //rawRulesJListDrum.setModel(rawRulesModelDrum);
   }

//private RepresentativeDrumRules.DrumPattern makeDrumPattern(String string)
//  {
//    String[] split = string.split("\n");
//    RepresentativeDrumRules.DrumPattern drumPattern = repDrumRules.makeDrumPattern();
//    for( int i = 1; i < split.length - 1; i++ )
//      {
//        RepresentativeDrumRules.DrumRule drumRule = repDrumRules.makeDrumRule();
//        int instrumentNumber = Integer.parseInt(split[i].substring(split[i].indexOf('m') + 2, split[i].indexOf('m') + 4));
//        drumRule.setInstrumentNumber(instrumentNumber);
//        int startIndex = split[i].indexOf('m') + 2;
//        int endIndex = split[i].indexOf(')');
//        String elements = split[i].substring(startIndex, endIndex);
//        String[] split2 = elements.split(" ");
//        // Start at 1 rather than 0, to skip over the drum number
//        for( int j = 1; j < split2.length; j++ )
//          {
//            drumRule.addElement(split2[j]);
//          }
//        String weightString = split[split.length - 1];
//
//        drumPattern.setWeight(1);
//        //System.out.println("adding drumPattern " + drumPattern);
//        drumPattern.addRule(drumRule);
//      }
//    return drumPattern;
//  }
*/

private void initComponents2()
  {
    java.awt.GridBagConstraints gridBagConstraints;
    LeadsheetFileView styView = new LeadsheetFileView();
    
    openStyle.setCurrentDirectory(styleDir);
    openStyle.setDialogType(JFileChooser.OPEN_DIALOG);
    openStyle.setDialogTitle("Open Style");
    openStyle.setFileSelectionMode(JFileChooser.FILES_ONLY);
    openStyle.resetChoosableFileFilters();
    openStyle.addChoosableFileFilter(new StyleFilter());
    openStyle.setFileView(styView);

    errorDialog = new javax.swing.JDialog();
    errorMessage = new javax.swing.JLabel();
    errorButton = new javax.swing.JButton();

    errorDialog.getContentPane().setLayout(new java.awt.GridBagLayout());

    errorDialog.setTitle("Error");
    errorDialog.setBackground(java.awt.Color.white);
    errorMessage.setForeground(new java.awt.Color(255, 0, 51));
    errorMessage.setText("jLabel1");
    gridBagConstraints = new java.awt.GridBagConstraints();
    gridBagConstraints.insets = new java.awt.Insets(8, 0, 0, 0);
    errorDialog.getContentPane().add(errorMessage, gridBagConstraints);

    errorButton.setText("OK");
    errorButton.addActionListener(new java.awt.event.ActionListener()
    {

    public void actionPerformed(java.awt.event.ActionEvent evt)
      {
        errorButtonActionPerformed(evt);
      }
    });
  }

private void errorButtonActionPerformed(java.awt.event.ActionEvent evt)
  {//GEN-FIRST:event_errorButtonActionPerformed
    errorDialog.setVisible(false);
  }//GEN-LAST:event_errorButtonActionPerformed



/**
 * This method is called from within the constructor to initialize the form.
 * WARNING: Do NOT modify this code. The content of this method is always
 * regenerated by the Form Editor.
 */
@SuppressWarnings("unchecked")
    // <editor-fold defaultstate="collapsed" desc="Generated Code">//GEN-BEGIN:initComponents
    private void initComponents()
    {
        java.awt.GridBagConstraints gridBagConstraints;

        styleMixerPanel = new javax.swing.JPanel();
        bassPatternButtonPanel = new javax.swing.JPanel();
        selectPatternBtnBass = new javax.swing.JButton();
        deletePatternBtnBass = new javax.swing.JButton();
        chordPatternButtonPanel = new javax.swing.JPanel();
        selectPatternBtnChord = new javax.swing.JButton();
        deletePatternBtnChord = new javax.swing.JButton();
        drumPatternButtonPanel = new javax.swing.JPanel();
        selectPatternBtnDrum = new javax.swing.JButton();
        deletePatternBtnDrum = new javax.swing.JButton();
        bassScrollPane = new javax.swing.JScrollPane();
        bassTable = new javax.swing.JTable();
        chordScrollPane = new javax.swing.JScrollPane();
        chordTable = new javax.swing.JTable();
        drumScrollPane = new javax.swing.JScrollPane();
        drumTable = new javax.swing.JTable();
        styleButtonPanel = new javax.swing.JPanel();
        playStyleButton = new javax.swing.JButton();
        copyStyleButton = new javax.swing.JButton();
        loadFileButton = new javax.swing.JButton();
        stopPlayingButton = new javax.swing.JButton();
        clearMixerButton = new javax.swing.JButton();
        mirrorPanel = new javax.swing.JPanel();
        nameLabel = new javax.swing.JLabel();
        nameField = new javax.swing.JTextField();
        patternLabel = new javax.swing.JLabel();
        patternField = new javax.swing.JTextField();
        extractionEditorMenuBar = new javax.swing.JMenuBar();
        windowMenu = new javax.swing.JMenu();
        closeWindowMI = new javax.swing.JMenuItem();
        cascadeMI = new javax.swing.JMenuItem();
        windowMenuSeparator = new javax.swing.JSeparator();

        setTitle("Style Mixer");
        setMinimumSize(new java.awt.Dimension(1220, 600));
        getContentPane().setLayout(new java.awt.GridBagLayout());

        styleMixerPanel.setLayout(new java.awt.GridBagLayout());

        bassPatternButtonPanel.setLayout(new java.awt.GridBagLayout());

        selectPatternBtnBass.setText("Copy Bass Patterns to Style Editor");
        selectPatternBtnBass.setToolTipText("Move the selected Bass Pattern to the next column of the Style Editor.");
        selectPatternBtnBass.setPreferredSize(new java.awt.Dimension(265, 23));
        selectPatternBtnBass.addActionListener(new java.awt.event.ActionListener()
        {
            public void actionPerformed(java.awt.event.ActionEvent evt)
            {
                copyBassPatternToStyleEditor(evt);
            }
        });
        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 0;
        gridBagConstraints.gridy = 1;
        gridBagConstraints.fill = java.awt.GridBagConstraints.HORIZONTAL;
        gridBagConstraints.weighty = 0.05;
        bassPatternButtonPanel.add(selectPatternBtnBass, gridBagConstraints);

        deletePatternBtnBass.setText("Delete Bass Pattern");
        deletePatternBtnBass.addActionListener(new java.awt.event.ActionListener()
        {
            public void actionPerformed(java.awt.event.ActionEvent evt)
            {
                deleteBassPattern(evt);
            }
        });
        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 0;
        gridBagConstraints.gridy = 2;
        gridBagConstraints.fill = java.awt.GridBagConstraints.HORIZONTAL;
        gridBagConstraints.weighty = 0.05;
        bassPatternButtonPanel.add(deletePatternBtnBass, gridBagConstraints);

        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 0;
        gridBagConstraints.gridy = 2;
        gridBagConstraints.fill = java.awt.GridBagConstraints.HORIZONTAL;
        styleMixerPanel.add(bassPatternButtonPanel, gridBagConstraints);

        chordPatternButtonPanel.setLayout(new java.awt.GridBagLayout());

        selectPatternBtnChord.setText("Copy Chord Patterns to Style Editor");
        selectPatternBtnChord.setToolTipText("Move the selected Chord Pattern to the next column of the Style Editor.");
        selectPatternBtnChord.addActionListener(new java.awt.event.ActionListener()
        {
            public void actionPerformed(java.awt.event.ActionEvent evt)
            {
                copyChordPatternToStyleEditor(evt);
            }
        });
        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 1;
        gridBagConstraints.gridy = 1;
        gridBagConstraints.fill = java.awt.GridBagConstraints.HORIZONTAL;
        gridBagConstraints.weighty = 0.05;
        chordPatternButtonPanel.add(selectPatternBtnChord, gridBagConstraints);

        deletePatternBtnChord.setText("Delete Chord Pattern");
        deletePatternBtnChord.setToolTipText("Delete Chord Pattern");
        deletePatternBtnChord.addActionListener(new java.awt.event.ActionListener()
        {
            public void actionPerformed(java.awt.event.ActionEvent evt)
            {
                deleteChordPattern(evt);
            }
        });
        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 1;
        gridBagConstraints.gridy = 2;
        gridBagConstraints.fill = java.awt.GridBagConstraints.HORIZONTAL;
        gridBagConstraints.weighty = 0.05;
        chordPatternButtonPanel.add(deletePatternBtnChord, gridBagConstraints);

        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 1;
        gridBagConstraints.gridy = 2;
        gridBagConstraints.fill = java.awt.GridBagConstraints.HORIZONTAL;
        styleMixerPanel.add(chordPatternButtonPanel, gridBagConstraints);

        drumPatternButtonPanel.setLayout(new java.awt.GridBagLayout());

        selectPatternBtnDrum.setText("Copy Drum Patterns to Style Editor");
        selectPatternBtnDrum.setToolTipText("Move the selected Drum Pattern to the next column of the Style Editor.");
        selectPatternBtnDrum.addActionListener(new java.awt.event.ActionListener()
        {
            public void actionPerformed(java.awt.event.ActionEvent evt)
            {
                copyDrumPatternToStyleEditor(evt);
            }
        });
        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 2;
        gridBagConstraints.gridy = 1;
        gridBagConstraints.fill = java.awt.GridBagConstraints.HORIZONTAL;
        gridBagConstraints.weighty = 0.05;
        drumPatternButtonPanel.add(selectPatternBtnDrum, gridBagConstraints);

        deletePatternBtnDrum.setText("Delete Drum Pattern");
        deletePatternBtnDrum.setToolTipText("Delete Drum Pattern");
        deletePatternBtnDrum.addActionListener(new java.awt.event.ActionListener()
        {
            public void actionPerformed(java.awt.event.ActionEvent evt)
            {
                deleteDrumPattern(evt);
            }
        });
        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 2;
        gridBagConstraints.gridy = 2;
        gridBagConstraints.fill = java.awt.GridBagConstraints.HORIZONTAL;
        gridBagConstraints.weighty = 0.05;
        drumPatternButtonPanel.add(deletePatternBtnDrum, gridBagConstraints);

        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 2;
        gridBagConstraints.gridy = 2;
        gridBagConstraints.fill = java.awt.GridBagConstraints.HORIZONTAL;
        styleMixerPanel.add(drumPatternButtonPanel, gridBagConstraints);

        bassScrollPane.setMinimumSize(new java.awt.Dimension(454, 404));

        bassTable.setBackground(java.awt.Color.orange);
        bassTable.setModel(new javax.swing.table.DefaultTableModel(
            new Object [][]
            {
                {null, null, null, null},
                {null, null, null, null},
                {null, null, null, null},
                {null, null, null, null}
            },
            new String []
            {
                "Title 1", "Title 2", "Title 3", "Title 4"
            }
        ));
        bassTable.addMouseListener(new java.awt.event.MouseAdapter()
        {
            public void mouseClicked(java.awt.event.MouseEvent evt)
            {
                bassTableMouseClicked(evt);
            }
        });
        bassScrollPane.setViewportView(bassTable);

        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 0;
        gridBagConstraints.gridy = 1;
        gridBagConstraints.fill = java.awt.GridBagConstraints.BOTH;
        gridBagConstraints.weightx = 0.1;
        styleMixerPanel.add(bassScrollPane, gridBagConstraints);

        chordScrollPane.setMinimumSize(new java.awt.Dimension(454, 404));

        chordTable.setBackground(java.awt.Color.green);
        chordTable.setModel(new javax.swing.table.DefaultTableModel(
            new Object [][]
            {
                {null, null, null, null},
                {null, null, null, null},
                {null, null, null, null},
                {null, null, null, null}
            },
            new String []
            {
                "Title 1", "Title 2", "Title 3", "Title 4"
            }
        ));
        chordTable.addMouseListener(new java.awt.event.MouseAdapter()
        {
            public void mouseClicked(java.awt.event.MouseEvent evt)
            {
                chordTableMouseClicked(evt);
            }
        });
        chordScrollPane.setViewportView(chordTable);

        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 1;
        gridBagConstraints.gridy = 1;
        gridBagConstraints.fill = java.awt.GridBagConstraints.BOTH;
        gridBagConstraints.weightx = 0.1;
        styleMixerPanel.add(chordScrollPane, gridBagConstraints);

        drumScrollPane.setMinimumSize(new java.awt.Dimension(454, 404));

        drumTable.setBackground(java.awt.Color.yellow);
        drumTable.setModel(new javax.swing.table.DefaultTableModel(
            new Object [][]
            {
                {null, null, null, null},
                {null, null, null, null},
                {null, null, null, null},
                {null, null, null, null}
            },
            new String []
            {
                "Title 1", "Title 2", "Title 3", "Title 4"
            }
        ));
        drumTable.addMouseListener(new java.awt.event.MouseAdapter()
        {
            public void mouseClicked(java.awt.event.MouseEvent evt)
            {
                drumTableMouseClicked(evt);
            }
        });
        drumScrollPane.setViewportView(drumTable);

        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 2;
        gridBagConstraints.gridy = 1;
        gridBagConstraints.gridwidth = 2;
        gridBagConstraints.fill = java.awt.GridBagConstraints.BOTH;
        gridBagConstraints.weightx = 0.1;
        styleMixerPanel.add(drumScrollPane, gridBagConstraints);

        styleButtonPanel.setLayout(new java.awt.GridBagLayout());

        playStyleButton.setText("Play Style");
        playStyleButton.setPreferredSize(new java.awt.Dimension(300, 23));
        playStyleButton.addActionListener(new java.awt.event.ActionListener()
        {
            public void actionPerformed(java.awt.event.ActionEvent evt)
            {
                playStyleButtonActionPerformed(evt);
            }
        });
        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 0;
        gridBagConstraints.gridy = 0;
        gridBagConstraints.fill = java.awt.GridBagConstraints.HORIZONTAL;
        gridBagConstraints.weightx = 0.33;
        gridBagConstraints.weighty = 0.05;
        styleButtonPanel.add(playStyleButton, gridBagConstraints);

        copyStyleButton.setText("Copy Style to Editor");
        copyStyleButton.setPreferredSize(new java.awt.Dimension(300, 23));
        copyStyleButton.addActionListener(new java.awt.event.ActionListener()
        {
            public void actionPerformed(java.awt.event.ActionEvent evt)
            {
                copyStyleButtonActionPerformed(evt);
            }
        });
        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 2;
        gridBagConstraints.gridy = 0;
        gridBagConstraints.fill = java.awt.GridBagConstraints.HORIZONTAL;
        gridBagConstraints.weightx = 0.33;
        gridBagConstraints.weighty = 0.05;
        styleButtonPanel.add(copyStyleButton, gridBagConstraints);

        loadFileButton.setText("Load Style From File");
        loadFileButton.setPreferredSize(new java.awt.Dimension(300, 23));
        loadFileButton.addActionListener(new java.awt.event.ActionListener()
        {
            public void actionPerformed(java.awt.event.ActionEvent evt)
            {
                loadFileButtonActionPerformed(evt);
            }
        });
        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 3;
        gridBagConstraints.gridy = 0;
        gridBagConstraints.fill = java.awt.GridBagConstraints.HORIZONTAL;
        gridBagConstraints.weightx = 0.33;
        gridBagConstraints.weighty = 0.05;
        styleButtonPanel.add(loadFileButton, gridBagConstraints);

        stopPlayingButton.setText("Stop Playing");
        stopPlayingButton.setPreferredSize(new java.awt.Dimension(300, 23));
        stopPlayingButton.addActionListener(new java.awt.event.ActionListener()
        {
            public void actionPerformed(java.awt.event.ActionEvent evt)
            {
                stopPlayingButtonActionPerformed(evt);
            }
        });
        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 1;
        gridBagConstraints.gridy = 0;
        gridBagConstraints.fill = java.awt.GridBagConstraints.HORIZONTAL;
        gridBagConstraints.weightx = 0.33;
        gridBagConstraints.weighty = 0.05;
        styleButtonPanel.add(stopPlayingButton, gridBagConstraints);

        clearMixerButton.setText("Clear Style Mixer");
        clearMixerButton.setPreferredSize(new java.awt.Dimension(300, 23));
        clearMixerButton.addActionListener(new java.awt.event.ActionListener()
        {
            public void actionPerformed(java.awt.event.ActionEvent evt)
            {
                clearMixerButtonActionPerformed(evt);
            }
        });
        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 4;
        gridBagConstraints.gridy = 0;
        gridBagConstraints.fill = java.awt.GridBagConstraints.HORIZONTAL;
        gridBagConstraints.weightx = 0.33;
        gridBagConstraints.weighty = 0.05;
        styleButtonPanel.add(clearMixerButton, gridBagConstraints);

        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 0;
        gridBagConstraints.gridy = 3;
        gridBagConstraints.gridwidth = 4;
        gridBagConstraints.fill = java.awt.GridBagConstraints.HORIZONTAL;
        styleMixerPanel.add(styleButtonPanel, gridBagConstraints);

        mirrorPanel.setMinimumSize(new java.awt.Dimension(804, 30));
        mirrorPanel.setLayout(new java.awt.GridBagLayout());

        nameLabel.setText("Name: ");
        nameLabel.setMaximumSize(new java.awt.Dimension(52, 16));
        nameLabel.setMinimumSize(new java.awt.Dimension(52, 16));
        nameLabel.setPreferredSize(new java.awt.Dimension(52, 16));
        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 0;
        gridBagConstraints.gridy = 0;
        gridBagConstraints.anchor = java.awt.GridBagConstraints.WEST;
        mirrorPanel.add(nameLabel, gridBagConstraints);

        nameField.setMinimumSize(new java.awt.Dimension(200, 22));
        nameField.setPreferredSize(new java.awt.Dimension(200, 28));
        mirrorPanel.add(nameField, new java.awt.GridBagConstraints());

        patternLabel.setText("Pattern: ");
        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 3;
        gridBagConstraints.gridy = 0;
        gridBagConstraints.anchor = java.awt.GridBagConstraints.WEST;
        mirrorPanel.add(patternLabel, gridBagConstraints);

        patternField.setMinimumSize(new java.awt.Dimension(500, 22));
        patternField.setPreferredSize(new java.awt.Dimension(500, 28));
        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 4;
        gridBagConstraints.gridy = 0;
        gridBagConstraints.fill = java.awt.GridBagConstraints.BOTH;
        mirrorPanel.add(patternField, gridBagConstraints);

        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 0;
        gridBagConstraints.gridy = 0;
        gridBagConstraints.gridwidth = 4;
        gridBagConstraints.fill = java.awt.GridBagConstraints.HORIZONTAL;
        styleMixerPanel.add(mirrorPanel, gridBagConstraints);

        gridBagConstraints = new java.awt.GridBagConstraints();
        gridBagConstraints.gridx = 0;
        gridBagConstraints.gridy = 0;
        gridBagConstraints.gridwidth = 4;
        gridBagConstraints.gridheight = 3;
        gridBagConstraints.fill = java.awt.GridBagConstraints.BOTH;
        gridBagConstraints.weightx = 1.0;
        gridBagConstraints.weighty = 1.0;
        getContentPane().add(styleMixerPanel, gridBagConstraints);

        windowMenu.setMnemonic('W');
        windowMenu.setText("Window");
        windowMenu.addMenuListener(new javax.swing.event.MenuListener()
        {
            public void menuSelected(javax.swing.event.MenuEvent evt)
            {
                windowMenuMenuSelected(evt);
            }
            public void menuDeselected(javax.swing.event.MenuEvent evt)
            {
            }
            public void menuCanceled(javax.swing.event.MenuEvent evt)
            {
            }
        });

        closeWindowMI.setMnemonic('C');
        closeWindowMI.setText("Close Window");
        closeWindowMI.setToolTipText("Closes the current window (exits program if there are no other windows)");
        closeWindowMI.addActionListener(new java.awt.event.ActionListener()
        {
            public void actionPerformed(java.awt.event.ActionEvent evt)
            {
                closeWindowMIActionPerformed(evt);
            }
        });
        windowMenu.add(closeWindowMI);

        cascadeMI.setMnemonic('A');
        cascadeMI.setText("Cascade Windows");
        cascadeMI.addActionListener(new java.awt.event.ActionListener()
        {
            public void actionPerformed(java.awt.event.ActionEvent evt)
            {
                cascadeMIActionPerformed(evt);
            }
        });
        windowMenu.add(cascadeMI);
        windowMenu.add(windowMenuSeparator);

        extractionEditorMenuBar.add(windowMenu);

        setJMenuBar(extractionEditorMenuBar);

        pack();
    }// </editor-fold>//GEN-END:initComponents

private void closeWindowMIActionPerformed(java.awt.event.ActionEvent evt)//GEN-FIRST:event_closeWindowMIActionPerformed
  {//GEN-HEADEREND:event_closeWindowMIActionPerformed
    dispose();
  }//GEN-LAST:event_closeWindowMIActionPerformed

private void cascadeMIActionPerformed(java.awt.event.ActionEvent evt)//GEN-FIRST:event_cascadeMIActionPerformed
  {//GEN-HEADEREND:event_cascadeMIActionPerformed
    WindowRegistry.cascadeWindows(this);
  }//GEN-LAST:event_cascadeMIActionPerformed

private void windowMenuMenuSelected(javax.swing.event.MenuEvent evt)//GEN-FIRST:event_windowMenuMenuSelected
  {//GEN-HEADEREND:event_windowMenuMenuSelected
    windowMenu.removeAll();

    windowMenu.add(closeWindowMI);

    windowMenu.add(cascadeMI);

    windowMenu.add(windowMenuSeparator);

    for( WindowMenuItem w : WindowRegistry.getWindows() )
      {
        windowMenu.add(w.getMI(this));      // these are static, and calling getMI updates the name on them too in case the window title changed
      }

    windowMenu.repaint();
  }//GEN-LAST:event_windowMenuMenuSelected

    private void copyDrumPatternToStyleEditor(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_copyDrumPatternToStyleEditor
        copySelectedDrumPatternsToStyleEditor();
    }//GEN-LAST:event_copyDrumPatternToStyleEditor

    private void copyChordPatternToStyleEditor(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_copyChordPatternToStyleEditor
        copySelectedChordPatternsToStyleEditor();
    }//GEN-LAST:event_copyChordPatternToStyleEditor

private void copyBassPatternToStyleEditor(java.awt.event.ActionEvent evt)//GEN-FIRST:event_copyBassPatternToStyleEditor
  {//GEN-HEADEREND:event_copyBassPatternToStyleEditor
     copySelectedBassPatternsToStyleEditor(); 
  }//GEN-LAST:event_copyBassPatternToStyleEditor

    private void deleteBassPattern(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_deleteBassPattern
       String name = (String)bassTable.getValueAt(bassTable.getSelectedRow(), NAME);
       bassTableModel.removeRow(bassTable.getSelectedRow());  
       bassRules.remove(name);
       bassPatternNames.remove(name);
    }//GEN-LAST:event_deleteBassPattern

    private void deleteChordPattern(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_deleteChordPattern
       String name = (String)chordTable.getValueAt(chordTable.getSelectedRow(), NAME);
       chordTableModel.removeRow(chordTable.getSelectedRow()); 
       chordRules.remove(name);
       chordPatternNames.remove(name);
    }//GEN-LAST:event_deleteChordPattern

    private void deleteDrumPattern(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_deleteDrumPattern
       int row = drumTable.getSelectedRow();
       String name = (String)drumTable.getValueAt(row, DRUM_NAME);
       drumTableModel.removeRow(row);
       drumRules.remove(name);
       drumRuleNames.remove(name);
    }//GEN-LAST:event_deleteDrumPattern

    private void playStyleButtonActionPerformed(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_playStyleButtonActionPerformed
        Style tempStyle = makeTempStyle();
        notate.playScore(tempStyle);
    }//GEN-LAST:event_playStyleButtonActionPerformed

    private void copyStyleButtonActionPerformed(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_copyStyleButtonActionPerformed
        StyleEditor newEditor = newStyleEditor();
        //WindowRegistry.registerWindow(newEditor);
        styleEditor = newEditor;
        copySelectedBassPatternsToStyleEditor();
        copySelectedChordPatternsToStyleEditor();
        copySelectedDrumPatternsToStyleEditor();
    }//GEN-LAST:event_copyStyleButtonActionPerformed

    private void loadFileButtonActionPerformed(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_loadFileButtonActionPerformed
        openStyle();
    }//GEN-LAST:event_loadFileButtonActionPerformed

    private void stopPlayingButtonActionPerformed(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_stopPlayingButtonActionPerformed
        notate.stopPlaying("StyleMixer");
    }//GEN-LAST:event_stopPlayingButtonActionPerformed

    private void clearMixerButtonActionPerformed(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_clearMixerButtonActionPerformed
        reset();
        //initComponents();
        //initComponents2();
    }//GEN-LAST:event_clearMixerButtonActionPerformed

    private void bassTableMouseClicked(java.awt.event.MouseEvent evt) {//GEN-FIRST:event_bassTableMouseClicked
        int row = bassTable.getSelectedRow();
        String pattern = (String)bassTable.getValueAt(row, PATTERN);
        playPattern(BASS, pattern);
        String name = (String)bassTable.getValueAt(row, NAME);
        updateMixerMirror( BASS_COLOR, name, pattern);      
    }//GEN-LAST:event_bassTableMouseClicked

    private void chordTableMouseClicked(java.awt.event.MouseEvent evt) {//GEN-FIRST:event_chordTableMouseClicked
        int row = chordTable.getSelectedRow();
        String pattern = (String)chordTable.getValueAt(row, PATTERN);
        playPattern(CHORD, pattern);
        String name = (String)chordTable.getValueAt(row, NAME);
        updateMixerMirror( CHORD_COLOR, name, pattern );
    }//GEN-LAST:event_chordTableMouseClicked

    private void drumTableMouseClicked(java.awt.event.MouseEvent evt) {//GEN-FIRST:event_drumTableMouseClicked
        int row = drumTable.getSelectedRow();
        String pattern = (String)drumTable.getValueAt(row, DRUM_RULE);
        playPattern(DRUM, pattern);
        String name = (String)drumTable.getValueAt(row, DRUM_NAME);
        updateMixerMirror( DRUM_COLOR, name, pattern );
    }//GEN-LAST:event_drumTableMouseClicked


    
    // Variables declaration - do not modify//GEN-BEGIN:variables
    private javax.swing.JPanel bassPatternButtonPanel;
    private javax.swing.JScrollPane bassScrollPane;
    private javax.swing.JTable bassTable;
    private javax.swing.JMenuItem cascadeMI;
    private javax.swing.JPanel chordPatternButtonPanel;
    private javax.swing.JScrollPane chordScrollPane;
    private javax.swing.JTable chordTable;
    private javax.swing.JButton clearMixerButton;
    private javax.swing.JMenuItem closeWindowMI;
    private javax.swing.JButton copyStyleButton;
    private javax.swing.JButton deletePatternBtnBass;
    private javax.swing.JButton deletePatternBtnChord;
    private javax.swing.JButton deletePatternBtnDrum;
    private javax.swing.JPanel drumPatternButtonPanel;
    private javax.swing.JScrollPane drumScrollPane;
    private javax.swing.JTable drumTable;
    private javax.swing.JMenuBar extractionEditorMenuBar;
    private javax.swing.JButton loadFileButton;
    private javax.swing.JPanel mirrorPanel;
    private javax.swing.JTextField nameField;
    private javax.swing.JLabel nameLabel;
    private javax.swing.JTextField patternField;
    private javax.swing.JLabel patternLabel;
    private javax.swing.JButton playStyleButton;
    private javax.swing.JButton selectPatternBtnBass;
    private javax.swing.JButton selectPatternBtnChord;
    private javax.swing.JButton selectPatternBtnDrum;
    private javax.swing.JButton stopPlayingButton;
    private javax.swing.JPanel styleButtonPanel;
    private javax.swing.JPanel styleMixerPanel;
    private javax.swing.JMenu windowMenu;
    private javax.swing.JSeparator windowMenuSeparator;
    // End of variables declaration//GEN-END:variables

private javax.swing.JButton errorButton;
private javax.swing.JDialog errorDialog;
private javax.swing.JLabel errorMessage;

  /**
   * Override dispose so as to unregister this window first.
   */
  
  @Override
  public void dispose()
    {
    WindowRegistry.unregisterWindow(this);
    super.dispose();
    }
 
/**
 * Opens the directory to choose a file to load into the mixer
 */
public void openStyle()
{
    if( openStyle.getCurrentDirectory().getAbsolutePath().equals("/") )
      {
      openStyle.setCurrentDirectory(styleDir);
      }
    //show open file dialog
    if( openStyle.showOpenDialog(this) == JFileChooser.APPROVE_OPTION )
      {
      // The opened file becomes the saved file, in case of save.
      savedStyle = openStyle.getSelectedFile();
      
      // Load the file.
      loadFromFile(savedStyle);
      }
}

/**
 * loads the patters from a style file into the style mixer
 * @param file 
 */
public void loadCleanFromFile( File file )
{
    reset();
    
    loadFromFile(file);
}

public void loadFromFile( File file )
{
    // Parse style.
    String s = OpenLeadsheetCommand.fileToString(file);
    
    if( s == null )
      {
        ErrorLog.log(ErrorLog.WARNING, "Unable to open style file: " + file.getName());
        return;
      }
    
    savedStyle = file;
    ImproVisor.setRecentStyleFile(file);
    
    s = s.substring(1, s.length() - 1);
    Polylist poly = Notate.parseListFromString(s);
    Style style = Style.makeStyle(Notate.parseListFromString(s));
    String styleName = style.getName();
    
    ArrayList<BassPattern> bp = style.getBP();
    ArrayList<DrumPattern> dp = style.getDP();
    ArrayList<ChordPattern> cp = style.getCP();
    
    //add all bass patterns into bassRules hash map
    for( int i = 0; i < bp.size(); i++ )
    {
        BassPattern curPat = bp.get(i);
        String name = curPat.getName();
        String rule = curPat.forGenerator();       
              
        int row = bassRules.size();
        
        if( name.equals("") )
        {
            name = "" + row;
        }
        
        bassPatternNames.add(name);
        bassRules.put(name, rule);
        //System.out.println("bass rules: " + bassRules);
        
        bassTable.setValueAt(USE_TRUE, row, USE); //set use cell
        bassTable.setValueAt(styleName, row, STYLE); //set style name cell
        bassTable.setValueAt(name, row, NAME); // set pattern name
        bassTable.setValueAt(rule, row, PATTERN); //set pattern
    }
    
    //add chord patterns into table and hash map
    for( int i = 0; i < cp.size(); i++)
    {
        ChordPattern curPat = cp.get(i);
        String name = curPat.getName();
        String rule = curPat.forGenerator();
               
        int row = chordRules.size();
        
        if( name.equals("") )
        {
            name = "" + row;
        }
        
        chordPatternNames.add(name);
        chordRules.put(name, rule);
        //System.out.println("chord rules: " + chordRules);
        
        chordTable.setValueAt(USE_TRUE, row, USE); //set use cell
        chordTable.setValueAt(styleName, row, STYLE); //set style name cell
        chordTable.setValueAt(name, row, NAME); // set pattern name
        chordTable.setValueAt(rule, row, PATTERN); //set pattern
    }
    
    //add drum patterns into table and hash map
    int patternSize = drumPatterns.size();
    for( int i = 0; i< dp.size(); i++ )
    {
        DrumPattern curPat = dp.get(i);
        String patternName = curPat.getName();
        ArrayList<DrumRuleRep> drums = curPat.getDrums();
        
        
        if( patternName.equals("") )
        {
            patternName = "" + (i + patternSize);
        }
        
        drumPatterns.put(patternName, drums);
        drumPatternNames.add(patternName);
        
        for( int j = 0; j < drums.size(); j++ )
        {
            DrumRuleRep curRep = drums.get(j);
            String name = curRep.getName();
            String rule = curRep.forStyleMixer();
            //System.out.println("drum rule: " + curRep.toString());
            
            int row = drumRules.size();
            ruleIndex.put(curRep, row);
            
            if( name.equals("") )
            {
                name = "" + row;
            }
            
            drumRules.put(name, rule);
            drumRuleNames.add(name);
            
            drumTable.setValueAt(USE_TRUE, row, DRUM_USE);
            drumTable.setValueAt(styleName, row, DRUM_STYLE);
            drumTable.setValueAt(patternName, row, DRUM_PATTERN_NAME);
            drumTable.setValueAt(name, row, DRUM_NAME);
            drumTable.setValueAt(rule, row, DRUM_RULE);
        }
    }
}

/**
 * Displays the selected pattern and name in the fields above the
 * instrument tables
 * @param color
 * @param name
 * @param pattern 
 */
public void updateMixerMirror(Color color, String name, String pattern)
{
        nameField.setBackground(color);
        patternField.setBackground(color);
        nameField.setText(name);
        patternField.setText(pattern);
}

/**
 * Used to copy the patterns for each instrument to the style editor
 */
public void copySelectedBassPatternsToStyleEditor()
{
    for(int i = 0; i < bassRules.size(); i++)
     {
         Boolean useValue = (Boolean)bassTable.getValueAt(i, USE);
         if( useValue )
         {
             String name = (String)bassTable.getValueAt(i, NAME);
             if( name.matches("[0-9]+") )
             {
                 name = "";
             }
             String pattern = (String)bassTable.getValueAt(i, PATTERN);
             styleEditor.setNextBassPattern(pattern, name);
         }
     } 
}

public void copySelectedChordPatternsToStyleEditor()
{
    for(int i = 0; i < chordRules.size(); i++)
    {
        Boolean useValue = (Boolean)chordTable.getValueAt(i, USE);
        if( useValue )
        {
            String name = (String)chordTable.getValueAt(i, NAME);
            if( name.matches("[0-9]+") )
            {
                name = "";
            }
            String pattern = (String)chordTable.getValueAt(i, PATTERN);
            styleEditor.setNextChordPattern(pattern, name);
        }
    } 
}

public void copySelectedDrumPatternsToStyleEditor()
{
    for( int i = 0; i < drumPatterns.size(); i++ )
    {
        String name = drumPatternNames.get(i);
        StringBuilder drumRules = new StringBuilder();
        drumRules.append("(");
        ArrayList<DrumRuleRep> rules = drumPatterns.get(name);
        
        if( name.matches("[0-9]+") )
            {
                name = "";
            }
        
        for( DrumRuleRep rep: rules )
        {
            //System.out.println("drum rule: " + rep);
            int repIndex = ruleIndex.get(rep);
            Boolean useValue = (Boolean)drumTable.getValueAt(repIndex, DRUM_USE);
            if( useValue )
            {
                drumRules.append(rep.toString().trim());
            }
        }
        //System.out.println("drum pattern: " + drumRules);
        //drumRules.append(")");
        styleEditor.setNextDrumPattern(drumRules.toString().trim(), name);
    }
}

/*

public Object getKey( Set keySet, int i )
{
    int count = 0;
    Iterator it = keySet.iterator();
    Object key = it.next();
    while( it.hasNext() )
    {
        if(count == i)
        {
            key = it.next();
            return key;
        }
        count++;
    }
    return key;
}
*/

//public int getPatternIndex( int i, int patternSize )
//{
    //if
//}


/**
 * Currently NOT used because of the changes to the style mixer
 * Could eventually be modified to copy patterns into the instrument tables
 * Copy a rectangle of cells for copying to the Style Mixer
 * @param cells
 * @param rowNumber
 * @param instrumentName 
 */
public void copyCellsForStyleMixer(Polylist cells, int rowNumber, String instrumentName[])
  {
    // cells are organized by column, so put each column into an array 
    // element.
    
      
    Polylist column[] = new Polylist[cells.length()];
    
    int j = 0;
    while( cells.nonEmpty() )
      {
        column[j++] = (Polylist)cells.first();
        cells = cells.rest();
      }
    
    int numColumns = j;
    
    int numRows = numColumns > 0 ? column[0].length() : 0;
    
    //System.out.println(numRows + " rows, " + numColumns + " columns");
    
    // Buffers for concatenating any drum rules by column
    PolylistBuffer buffer[] = new PolylistBuffer[numColumns];
    
    for( j = 0; j < numColumns; j++ )
      {
         buffer[j] = new PolylistBuffer();
       }

    for( int i = 0; i < numRows; i++ )
      {
        for( j = 0; j < numColumns; j++ )
          {
            int trueRow = rowNumber + i;
            Polylist item = (Polylist)column[j].first();
            
            if( item.nonEmpty() && !item.toString().equals("()") )
              {
              //System.out.println("row " + trueRow + ", column " + j + ": " + item);
              switch(trueRow)
                {
                case StyleTableModel.BASS_PATTERN_ROW:
                    //if( !containsAsString(rawRulesModelBass, item) )
                    //{
                    //rawRulesModelBass.addElement(item);
                    //}
                 break;
                  
                case StyleTableModel.CHORD_PATTERN_ROW:
                    //if( !containsAsString(rawRulesModelChord, item) )
                    //{
                    //rawRulesModelChord.addElement(item);
                    //}
                 break;
                  
                default:
                 // Buffer drum rules as belonging to a paJttern in a given
                 // column. At the end of transfer, create drum patterns out
                 // of rules stored in a specific buffer.
                 if( trueRow >= StyleTableModel.FIRST_PERCUSSION_INSTRUMENT_ROW)
                      {
                      buffer[j].append(item.cons(instrumentName[i]).cons(DRUM_SYMBOL));    
                      }
                }
              }
            
            column[j] = column[j].rest();
          }
      }
    
    for( j = 0; j < numColumns; j++ )
      {
        Polylist L = buffer[j].toPolylist();
        if( L.nonEmpty() )
          {
            //if ( !containsAsString(rawRulesModelDrum, L) )
            //{
             //rawRulesModelDrum.addElement(L);
            //}
          }
      }
    saveStylePatterns();
  }

  /*
   * Only used in the method above, which isn't used currently
   */
  public void saveStylePatterns()
    {
    String eol = System.getProperty( "line.separator" );
  
    File file = ImproVisor.getStyleMixerFile();
    try
      {
      BufferedWriter out = new BufferedWriter(new FileWriter(file));

      StringBuilder buffer = new StringBuilder();
        
      //for( Enumeration e = rawRulesModelBass.elements(); e.hasMoreElements(); )
      //{
          buffer.append("(bass-pattern ");
          //buffer.append(e.nextElement().toString());
          buffer.append(")");
          buffer.append(eol);
      //}
      
      //for( Enumeration e = rawRulesModelChord.elements(); e.hasMoreElements(); )
      //{
          buffer.append("(chord-pattern ");
          //buffer.append(e.nextElement().toString());
          buffer.append(")");
          buffer.append(eol);
      //}
            
      //for( Enumeration e = rawRulesModelDrum.elements(); e.hasMoreElements(); )
      //{
          buffer.append("(drum-pattern ");
          //buffer.append((e.nextElement()).toString().substring(1));
          buffer.append(eol);
      //}            
      
      String styleResult = buffer.toString();
      
      //System.out.println("Saving mixer patterns to file: " + eol + styleResult);
      
      out.write(styleResult);
      out.close();

       }
    catch( Exception e )
      {
      }
    }
  
  /*
   * Not used currently
   */
  private void loadStyleMixerPatterns()
  {
  File mixerFile = ImproVisor.getStyleMixerFile();
  try
    {
    FileInputStream fis = new FileInputStream(mixerFile);
    Tokenizer in = new Tokenizer(fis);
    Object token;
         
    // Read in S expressions until end of file is reached
    while ((token = in.nextSexp()) != Tokenizer.eof)
     {
      //System.out.println("token = " + token);
      Polylist tokenP = (Polylist)token;
      if(tokenP.first().equals("bass-pattern"))
        {
          //rawRulesModelBass.addElement(tokenP.second());
        }
      else if(tokenP.first().equals("chord-pattern"))
        {
          //rawRulesModelChord.addElement(tokenP.second());
        }
      else if(tokenP.first().equals("drum-pattern"))
        {
          //rawRulesModelDrum.addElement(tokenP.rest());
        }   
    }
  }
  catch( java.io.FileNotFoundException e )
        { 
            ErrorLog.log(ErrorLog.WARNING, "StyleMixer file not found");
        }
  }
  
private void playPattern(int type, String string)
  {
   //String string;
   PatternDisplay display;
   switch( type )
     {
       case BASS:
           //string = polylist.toStringSansParens();
           display = new BassPatternDisplay(string, 1.0f, styleEditor.getNotate(), null, styleEditor);
           //System.out.println("display = " + display);
           display.playMe();
           break;
           
        case CHORD:
           //string = polylist.toStringSansParens();
           display = new ChordPatternDisplay(string, 1.0f, "", styleEditor.getNotate(), null, styleEditor);
           //System.out.println("display = " + display);
           display.playMe();
           break;
           
           
       case DRUM:
           Polylist polylist = Polylist.PolylistFromString(string);
           Polylist pattern = (Polylist)polylist.rest();
           Long longNumber = (Long)polylist.first();
           int number = longNumber.intValue();
           String instrument = MIDIBeast.spacelessDrumNameFromNumber(number);
           //Polylist patternProper = subpattern.rest().rest();
           DrumRuleDisplay rule = new DrumRuleDisplay(pattern.toStringSansParens(), instrument, styleEditor.getNotate(), null, styleEditor);
           //dpd.addRule(rule);
           //polylist = polylist.rest();
           rule.playMe();
           break;
     }
  }

public Style makeTempStyle()
{
    StringBuilder buffer = new StringBuilder();
    //convert all the patterns to a polylist
    for( int i = 0; i < bassPatternNames.size(); i++ )
    {
        String key = bassPatternNames.get(i);
        String pattern = bassRules.get(key);
        Boolean useValue = (Boolean)bassTable.getValueAt(i, USE);
        //System.out.println(useString);
        if( useValue )
        {
            buffer.append("(bass-pattern ");
            buffer.append("(rules ");
            buffer.append(pattern);
            buffer.append(")(weight 10.0))");
        }      
    }
    
    for( int j = 0; j < chordPatternNames.size(); j++ )
    {
        String key = chordPatternNames.get(j);
        String pattern = chordRules.get(key);
        Boolean useValue = (Boolean)chordTable.getValueAt(j, USE);
        if( useValue )
        {
            buffer.append("(chord-pattern ");
            buffer.append("(rules ");
            buffer.append(pattern);
            buffer.append(")(weight 10.0))");
        } 
    }
    
    for( int k = 0; k < drumPatterns.size(); k++ )
    {
        String key = drumPatternNames.get(k);
        buffer.append("(drum-pattern ");
        ArrayList<DrumRuleRep> drumRules = drumPatterns.get(key);
        
        for( DrumRuleRep rep: drumRules )
        {
            //System.out.println("drum rule: " + rep);
            int repIndex = ruleIndex.get(rep);
            Boolean useValue = (Boolean)drumTable.getValueAt(k, USE);
            if( useValue )
            {
                buffer.append(rep.toString().trim());
            }
        }
        buffer.append(")");
    }
    String styleString = buffer.toString();
    Polylist style = Polylist.PolylistFromString(styleString);
    Style tempStyle = Style.makeStyle(style);
    return tempStyle;
}

/**
 * Checks to see if model contains p, using String equivalence as a basis
 * of comparison.
 * @param model
 * @param p
 * @return 
 */
/*
boolean containsAsString(DefaultListModel model, Polylist p)
  {
    String s = p.toString();
    for( Enumeration e = model.elements(); e.hasMoreElements(); )
      {
        if( s.equals(e.nextElement().toString() ))
          {
            return true;
          }
      }
    return false;
  }
  */
}

```

### File: src\imp\voicing\HandManager.java

```java

/**
 * This Java Class is part of the Impro-Visor Application.
 *
 * Copyright (C) 2015-2017 Robert Keller and Harvey Mudd College
 *
 * Impro-Visor is free software; you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation; either version 2 of the License, or (at your option) any later
 * version.
 *
 * Impro-Visor is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of merchantability or fitness
 * for a particular purpose. See the GNU General Public License for more
 * details.
 *
 * You should have received a copy of the GNU General Public License along with
 * Impro-Visor; if not, write to the Free Software Foundation, Inc., 51 Franklin
 * St, Fifth Floor, Boston, MA 02110-1301 USA
 */

package imp.voicing;

/**
 * facilitates hand movement by moving the hands between the lower and upper limits based on parameters set by the user
 * @author Daniel Scanteianu
 */
public class HandManager {
    private int leftHandLowerLimit;
    private int rightHandLowerLimit;
    private int leftHandUpperLimit;
    private int rightHandUpperLimit;
    private int leftHandSpread;
    private int rightHandSpread;
    private int leftHandMinNotes;

    public HandManager() {
        resetHands();
    }
    /*
    public HandManager(int leftHandLowerLimit, int rightHandLowerLimit, int leftHandUpperLimit, int rightHandUpperLimit, int leftHandSpread, int rightHandSpread, int leftHandMinNotes, int leftHandMaxNotes, int rightHandMinNotes, int preferredMotion, int preferredMotionRange) {
        this.leftHandLowerLimit = leftHandLowerLimit;
        this.rightHandLowerLimit = rightHandLowerLimit;
        this.leftHandUpperLimit = leftHandUpperLimit;
        this.rightHandUpperLimit = rightHandUpperLimit;
        this.leftHandSpread = leftHandSpread;
        this.rightHandSpread = rightHandSpread;
        this.leftHandMinNotes = leftHandMinNotes;
        this.leftHandMaxNotes = leftHandMaxNotes;
        this.rightHandMinNotes = rightHandMinNotes;
        this.preferredMotion = preferredMotion;
        this.preferredMotionRange = preferredMotionRange;
    }*/
    private int leftHandMaxNotes;
    private int rightHandMinNotes;
    private int rightHandMaxNotes;
    private int leftHandLowestNote;//used for calculating limits for current chord
    private int rightHandLowestNote;//used for calculating the limits for current chord
    private int preferredMotion;//set positive for moving up when possible, negative for moving down when possible, zero to keep the hands in the same place
    private int preferredMotionRange;//this is the plus/minus for preferred motion
    
    public void getSettings(AutomaticVoicingSettings av)
    {
        setLeftHandLowerLimit(av.getLeftHandLowerLimit());
        setLeftHandUpperLimit(av.getLeftHandUpperLimit());
        setLeftHandSpread(av.getLeftHandSpread());
        setRightHandLowerLimit(av.getRightHandLowerLimit());
        setRightHandUpperLimit(av.getRightHandUpperLimit());
        setRightHandSpread(av.getRightHandSpread());
        setLeftHandMinNotes(av.getLeftHandMinNotes());
        setLeftHandMaxNotes(av.getLeftHandMaxNotes());
        setRightHandMinNotes(av.getRightHandMinNotes());
        setRightHandMaxNotes(av.getRightHandMaxNotes());
        setPreferredMotion(av.getPreferredMotion());
        setPreferredMotionRange(av.getPreferredMotionRange());
    }
    
    /**
     * randomly generates a number of notes for the LH to play within range
     * @return a number of notes
     */
    public int getNumLeftNotes()
    {
        return (int)Math.round(Math.random()*(leftHandMaxNotes-leftHandMinNotes)) + leftHandMinNotes;
    }
    /**
     * randomly generate a number of notes for the RH to play within range
     * @return a number of notes
     */
    public int getNumRightNotes()
    {
        return (int)Math.round(Math.random()*(rightHandMaxNotes-rightHandMinNotes)) + rightHandMinNotes;
    }

    public int getLeftHandLowerLimit() {
        return leftHandLowerLimit;
    }
    
    public void setLeftHandLowerLimit(int leftHandLowerLimit) {
        this.leftHandLowerLimit = leftHandLowerLimit;
    }

    public int getRightHandLowerLimit() {
        return rightHandLowerLimit;
    }

    public void setRightHandLowerLimit(int rightHandLowerLimit) {
        this.rightHandLowerLimit = rightHandLowerLimit;
    }

    public int getLeftHandUpperLimit() {
        return leftHandUpperLimit;
    }

    public void setLeftHandUpperLimit(int leftHandUpperLimit) {
        this.leftHandUpperLimit = leftHandUpperLimit;
    }

    public int getRightHandUpperLimit() {
        return rightHandUpperLimit;
    }

    public void setRightHandUpperLimit(int rightHandUpperLimit) {
        this.rightHandUpperLimit = rightHandUpperLimit;
    }

    public int getLeftHandSpread() {
        return leftHandSpread;
    }

    public void setLeftHandSpread(int leftHandSpread) {
        this.leftHandSpread = leftHandSpread;
    }

    public int getRightHandSpread() {
        return rightHandSpread;
    }

    public void setRightHandSpread(int rightHandSpread) {
        this.rightHandSpread = rightHandSpread;
    }

    public int getLeftHandMinNotes() {
        return leftHandMinNotes;
    }

    public int getLeftHandLowestNote() {
        return leftHandLowestNote;
    }

    public void setLeftHandLowestNote(int leftHandLowestNote) {
        this.leftHandLowestNote = leftHandLowestNote;
    }

    public void setLeftHandMinNotes(int leftHandMinNotes) {
        this.leftHandMinNotes = leftHandMinNotes;
    }

    public int getLeftHandMaxNotes() {
        return leftHandMaxNotes;
    }

    public void setLeftHandMaxNotes(int leftHandMaxNotes) {
        this.leftHandMaxNotes = leftHandMaxNotes;
    }

    public int getRightHandMinNotes() {
        return rightHandMinNotes;
    }

    public void setRightHandMinNotes(int rightHandMinNotes) {
        this.rightHandMinNotes = rightHandMinNotes;
    }

    public int getRightHandMaxNotes() {
        return rightHandMaxNotes;
    }

    public void setRightHandMaxNotes(int rightHandMaxNotes) {
        this.rightHandMaxNotes = rightHandMaxNotes;
    }

    public int getRightHandLowestNote() {
        return rightHandLowestNote;
    }

    public void setRightHandLowestNote(int rightHandLowestNote) {
        this.rightHandLowestNote = rightHandLowestNote;
    }

    public int getPreferredMotion() {
        return preferredMotion;
    }

    public void setPreferredMotion(int preferredMotion) {
        this.preferredMotion = preferredMotion;
    }

    public int getPreferredMotionRange() {
        return preferredMotionRange;
    }

    public void setPreferredMotionRange(int preferredMotionRange) {
        this.preferredMotionRange = preferredMotionRange;
    }
    /**
     * moves hands between chords, ensuring that voicings are in ranges.
     */
    public void repositionHands()
    {
      //System.out.println("lll "+this.leftHandLowerLimit+"rll "+this.rightHandLowerLimit);
      //System.out.println("lul "+this.leftHandUpperLimit+"rul "+this.rightHandUpperLimit);
      //System.out.println("ll "+this.leftHandLowestNote+"rl "+this.rightHandLowestNote);
       leftHandLowestNote=(int)Math.round(leftHandLowestNote+((Math.random()*2.0*preferredMotionRange)-preferredMotionRange)+preferredMotion);
       rightHandLowestNote=(int)Math.round(rightHandLowestNote+((Math.random()*2.0*preferredMotionRange)-preferredMotionRange)+preferredMotion);
       if(leftHandLowestNote<leftHandLowerLimit)
           resetLH();
       if(rightHandLowestNote<rightHandLowerLimit)
           resetRH();
       if(leftHandLowestNote+leftHandSpread>leftHandUpperLimit)
           resetLH();
       if(rightHandLowestNote+rightHandSpread>rightHandUpperLimit)
           resetRH();
       
    }
    /**
     * sets hands to a starting position based on settings
     */
    public void resetHands()
    {
        if(preferredMotion>0)//to allow motion up
        {
            leftHandLowestNote=leftHandLowerLimit;
            rightHandLowestNote=rightHandLowerLimit;
        }
        else if(preferredMotion<0)//to allow motion down
        {
            leftHandLowestNote=leftHandUpperLimit-leftHandSpread;
            rightHandLowestNote=rightHandUpperLimit-rightHandSpread;
        }
        else //start in the middle to be able to go both ways
        {
            leftHandLowestNote=(leftHandUpperLimit-leftHandSpread+leftHandLowerLimit)/2;
            rightHandLowestNote=(rightHandUpperLimit-rightHandSpread+rightHandLowerLimit)/2;
        }
        VoicingDebug.println("Both Hands Reset");
    }
    public void resetLH()
    {
        if(preferredMotion>0)//to allow motion up
        {
            leftHandLowestNote=leftHandLowerLimit;
            //rightHandLowestNote=rightHandLowerLimit;
        }
        else if(preferredMotion<0)//to allow motion down
        {
            leftHandLowestNote=leftHandUpperLimit-leftHandSpread;
            //rightHandLowestNote=rightHandUpperLimit-rightHandSpread;
        }
        else //start in the middle to be able to go both ways
        {
            leftHandLowestNote=(leftHandUpperLimit-leftHandSpread+leftHandLowerLimit)/2;
            //rightHandLowestNote=(rightHandUpperLimit-rightHandSpread+rightHandLowerLimit)/2;
        }
    }
    public void resetRH()
    {
        if(preferredMotion>0)//to allow motion up
        {
            //leftHandLowestNote=leftHandLowerLimit;
            rightHandLowestNote=rightHandLowerLimit;
        }
        else if(preferredMotion<0)//to allow motion down
        {
            //leftHandLowestNote=leftHandUpperLimit-leftHandSpread;
            rightHandLowestNote=rightHandUpperLimit-rightHandSpread;
        }
        else //start in the middle to be able to go both ways
        {
            //leftHandLowestNote=(leftHandUpperLimit-leftHandSpread+leftHandLowerLimit)/2;
            rightHandLowestNote=(rightHandUpperLimit-rightHandSpread+rightHandLowerLimit)/2;
        }
        VoicingDebug.println("RH Reset");
    }
    public int getLeftLowerBound()
    {
        return leftHandLowestNote;
    }
     public int getLeftUpperBound()
    {
        return leftHandLowestNote+leftHandSpread;
    }
      public int getRightLowerBound()
    {
        return rightHandLowestNote;
    }
       public int getRightUpperBound()
    {
        return rightHandLowestNote+rightHandSpread;
    }
}

```

