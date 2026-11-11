const formatMessage = require('format-message');
const languageNames = require('scratch-translate-extension-languages');
const uuid = require('uuid');

const ArgumentType = require('../../extension-support/argument-type');
const BlockType = require('../../extension-support/block-type');
const Cast = require('../../util/cast');

const categoryStyles = require('./common');
const Music = require('./music');
const ActionBundles = require('./bundles');
const robotActions = require('./bundles/actions');
const bundleProtocol = require('./bundles/protocol');
const publicAPI = require('./api');
const ConnectionManager = require('./connection/connection-manager');

const CLIENT_UUID_STORAGE_KEY = 'tinkiblocks.blocksUuid';
const CLAIMED_BY_OTHER_USER = 'another-user';

let the_locale = null;

//-----------------------------------
//  TINKIMO RESPONSES
//-----------------------------------

/**
 * Class for the text2speech blocks.
 * @class
 */
class TinkibotBlocks {
    constructor (runtime) {
        /**
         * The runtime instantiating this block package.
         * @type {Runtime}
         */
        this.runtime = runtime;
        this._music = new Music(runtime);
        this._bundler = new ActionBundles(this);
        this._connected = false;
        this._connectionPromise = null;
        this._commandQueue = Promise.resolve();
        this._queuedCommands = 0;
        this._pendingResponse = null;
        this._buttonEvent = null;
        this._connectedRobots = [];
        this._pendingClaims = new Map();
        this._pendingRemovals = new Map();
        this._pendingReleases = new Map();
        this._clientUuid = this._getClientUuid();
        this.runtime.claimTinkibotRobot = this.claimRobot.bind(this);
        this.runtime.releaseTinkibotRobot = this.releaseRobot.bind(this);
        this.runtime.removeTinkibotRobot = this.removeRobot.bind(this);
        this.connectionManager = new ConnectionManager({
            connect: () => this._connectProxy(),
            send: payload => this._proxySocket.send(JSON.stringify(payload)),
            disconnect: () => this._disconnectProxy(),
            isBusy: () => Boolean(this._queuedCommands || this._pendingResponse || this._pendingClaims.size ||
                this._pendingRemovals.size || this._pendingReleases.size)
        });
        this.connectionManager.clientUuid = this._clientUuid;
        this.connectionManager.on('message', response => this._handleRobotMessage(response));
        this.connectionManager.on('ready', () => {
            this._connected = true;
        });
        this.connectionManager.on('disconnected', error => {
            this._connected = false;
            this._pendingClaims.clear();
            this._pendingRemovals.clear();
            this._pendingReleases.clear();
            this._rejectPending(error, false);
            this._setConnectedRobots(this._connectedRobots.map(robot => ({...robot, connected: false})));
        });
        this.runtime.tinkibotConnectionManager = this.connectionManager;
        if (typeof window !== 'undefined' && typeof WebSocket !== 'undefined') {
            this.connectionManager.start().catch(error => this.connectionManager.log('error', error.message));
        }
    }

    /**
     * @returns {object} metadata for this extension and its blocks.
     */
    getInfo () {
        return this.getInfos()[0];
    }

    getInfos () {
        const info = this._getCombinedInfo();
        return [
            this._categoryInfo(info, 'tinkibotMovement', formatMessage({
                id: 'tinkibot.category.movement',
                default: 'Movement',
                description: 'Name of the Tinkibot Movement category.'
            }), [
                'measure_left_encoder_count', 'measure_right_encoder_count', 'drive', 'stop', 'brake',
                'move', 'rotate', 'arc'
            ]),
            this._categoryInfo(info, 'tinkibotDance', formatMessage({
                id: 'tinkibot.category.dance',
                default: 'Dance',
                description: 'Robot dances and playful effects.'
            }), ['wiggle', 'moonwalk', 'fade']),
            this._categoryInfo(info, 'tinkibotInteraction', formatMessage({
                id: 'tinkibot.category.interaction',
                default: 'Interaction',
                description: 'Name of the Tinkibot Interaction category.'
            }), [
                'read_button', 'when_button_event', 'button_led'
            ]),
            this._categoryInfo(info, 'tinkibotSensors', formatMessage({
                id: 'tinkibot.category.sensors',
                default: 'Sensors',
                description: 'Name of the Tinkibot Sensors category.'
            }), [
                'measure_line_sensor', 'measure_distance', 'measure_voltage'
            ]),
            this._categoryInfo(info, 'tinkibotSounds', formatMessage({
                id: 'tinkibot.category.sounds',
                default: 'Sounds',
                description: 'Name of the Tinkibot Sounds category.'
            }), ['volume', 'play_sound', 'preload_audio', 'playNoteForBeats', 'playDrumForBeats', 'restForBeats',
                'setTempo', 'changeTempo']),
            this._categoryInfo(info, 'tinkibotDisplay', formatMessage({
                id: 'tinkibot.category.display',
                default: 'Display',
                description: 'Name of the Tinkibot Display category.'
            }), [
                'display_image', 'display_letter', 'display_number', 'mosaic', 'write_text', 'text_colour',
                'background_colour', 'backlight', 'preload_image', 'clear'
            ])
        ];
    }

    _categoryInfo (info, id, name, opcodes) {
        return Object.assign({}, info, {
            id,
            name,
            ...categoryStyles[id],
            blocks: info.blocks.filter(block => block !== '---' && opcodes.includes(block.opcode))
        });
    }

    _getCombinedInfo () {
        the_locale = this._setLocale();        

        const info = {
            id: 'tinkibot',
            name: formatMessage({
                id: 'tinkibot.categoryName',
                default: 'Tinkibots',
                description: 'Name of the Tinkibot extension.'
            }),
            blocks: [
                {
                    opcode: 'playNoteForBeats',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.playNoteForBeats',
                        default: 'play [NOTE] for [BEATS] beats',
                        description: 'Play a musical note through the robot speaker'
                    }),
                    arguments: {
                        NOTE: {type: ArgumentType.NOTE, defaultValue: 60},
                        BEATS: {type: ArgumentType.NUMBER, defaultValue: 0.25}
                    }
                },
                {
                    opcode: 'playDrumForBeats',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.playDrumForBeats',
                        default: 'play drum [DRUM] for [BEATS] beats',
                        description: 'Play a synthesized drum hit and wait a number of beats'
                    }),
                    arguments: {
                        DRUM: {type: ArgumentType.NUMBER, defaultValue: 1, menu: 'drum_options'},
                        BEATS: {type: ArgumentType.NUMBER, defaultValue: 0.25}
                    }
                },
                {
                    opcode: 'restForBeats',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.restForBeats',
                        default: 'rest for [BEATS] beats',
                        description: 'Pause for a number of musical beats'
                    }),
                    arguments: {BEATS: {type: ArgumentType.NUMBER, defaultValue: 0.25}}
                },
                {
                    opcode: 'setTempo',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.setTempo',
                        default: 'set tempo to [TEMPO]',
                        description: 'Set the musical tempo in beats per minute'
                    }),
                    arguments: {TEMPO: {type: ArgumentType.NUMBER, defaultValue: 60}}
                },
                {
                    opcode: 'changeTempo',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.changeTempo',
                        default: 'change tempo by [TEMPO]',
                        description: 'Change the musical tempo in beats per minute'
                    }),
                    arguments: {TEMPO: {type: ArgumentType.NUMBER, defaultValue: 20}}
                },
                {
                    opcode: 'volume',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.volume',
                        default: 'set volume [VALUE]',
                        description: 'set the speaker volume'
                    }),
                    arguments: {
                        VALUE: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 5
                        }                        
                    }
                },                 
                {
                    opcode: 'play_sound',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.playSound',
                        default: 'play sound [SOUND]',
                        description: 'Play a sound from the MP3 library'
                    }),
                    arguments: {
                        SOUND: {
                            type: ArgumentType.STRING,
                            defaultValue: 'startup',
                            menu: "sound_options"
                        },
                    }
                },
                {
                    opcode: 'preload_audio',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.preloadAudio',
                        default: 'preload [AUDIO] for use',
                        description: 'Load a sound into memory for quick playback'
                    }),
                    arguments: {
                        AUDIO: {
                            type: ArgumentType.STRING,
                            defaultValue: 'startup',
                            menu: 'sound_options'
                        }
                    }
                },
                '---',                          
                {
                    opcode: 'measure_line_sensor',
                    blockType: BlockType.REPORTER,
                   text: formatMessage({
                        id: 'tinkibot.measureLineSensor',
                        default: 'measure line sensor [SENSOR]',
                        description: 'Measure the line sensor value'
                    }),
                    arguments: {
                        SENSOR: {
                            type: ArgumentType.STRING,
                            defaultValue: '4',
                            menu: "line_sensors_options"
                        },                   
                    }
                    
                }, 
                '---',                          
                {
                    opcode: 'read_button',
                    blockType: BlockType.REPORTER,
                   text: formatMessage({
                        id: 'tinkibot.readButton',
                        default: 'was [BUTTON] pressed?',
                        description: 'Was button pressed?'
                    }),
                    arguments: {
                        BUTTON: {
                            type: ArgumentType.STRING,
                            defaultValue: 'top-left',
                            menu: 'button_options'
                        },                   
                    }
                    
                },  
                {
                    opcode: 'when_button_event',
                    blockType: BlockType.HAT,
                    isEdgeActivated: false,
                    text: formatMessage({
                        id: 'tinkibot.whenButtonEvent',
                        default: 'Listen for button [BUTTON] being [STATE]',
                        description: 'Run when a button changes to the selected state'
                    }),
                    arguments: {
                        BUTTON: {
                            type: ArgumentType.STRING,
                            defaultValue: 'top-left',
                            menu: "button_options"
                        },
                        STATE: {
                            type: ArgumentType.STRING,
                            defaultValue: 'pressed',
                            menu: 'button_state_options'
                        }
                    }
                },
                {
                    opcode: 'button_led',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.buttonLed',
                        default: 'set [BUTTON] to [STATE]',
                        description: 'turn on or off an LED button'
                    }),
                    arguments: {
                        BUTTON: {
                            type: ArgumentType.STRING,
                            defaultValue: 'top-left',
                            menu: "button_options"
                        },
                        STATE: {
                            type: ArgumentType.STRING,
                            defaultValue: 'on',
                            menu: "state_options"
                        }                                                                            
                    }
                },                 

                '---',                          
                {
                    opcode: 'measure_distance',
                    blockType: BlockType.REPORTER,
                   text: formatMessage({
                        id: 'tinkibot.measureDistance',
                        default: 'measure distance',
                        description: 'Measure the distance in centimeters'
                    }),
                    arguments: {
                    }
                },
                {
                    opcode: 'measure_voltage',
                    blockType: BlockType.REPORTER,
                   text: formatMessage({
                        id: 'tinkibot.measureVoltage',
                        default: 'measure battery voltage',
                        description: 'Measure the internale battery voltage.'
                    }),
                    arguments: {
                    }
                },  
                '---',                          
                {
                    opcode: 'display_image',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.displayImage',
                        default: 'display image [IMAGE]',
                        description: 'show an image from the library'
                    }),
                    arguments: {
                        IMAGE: {
                            type: ArgumentType.STRING,
                            defaultValue: 'logo',
                            menu: "image_options"
                        },
                    }
                },
                {
                    opcode: 'display_letter',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.displayLetter',
                        default: 'display letter [IMAGE]',
                        description: 'show a single letter on the screen'
                    }),
                    arguments: {
                        IMAGE: {
                            type: ArgumentType.STRING,
                            defaultValue: 'A',
                            menu: "letter_options"
                        },
                    }
                },                  
                {
                    opcode: 'display_number',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.displayNumber',
                        default: 'display number [IMAGE]',
                        description: 'show a single number on the screen'
                    }),
                    arguments: {
                        IMAGE: {
                            type: ArgumentType.STRING,
                            defaultValue: '0',
                            menu: "number_options"
                        },
                    }
                },  
                {                
                    opcode: 'mosaic',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.mosaic',
                        default: 'create mosaic of [IMAGE]',
                        description: 'show an image from the library'
                    }),
                    arguments: {
                        IMAGE: {
                            type: ArgumentType.STRING,
                            defaultValue: 'logo',
                            menu: "mosaic_options"
                        },
                    }
                }, 
                {
                    opcode: 'write_text',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.writeText',
                        default: 'write text [MESSAGE] at [X],[Y]',
                        description: 'write some text to the screen'
                    }),
                    arguments: {
                        MESSAGE: {
                            type: ArgumentType.STRING,
                            defaultValue: "Tinkibots Rule!"
                        },
                        X: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 3
                        },
                        Y: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 70
                        }                                                                            
                    }
                },                 
                {
                    opcode: 'text_colour',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.textColour',
                        default: 'change the text colour to [COLOUR]',
                        description: 'change the text colour'
                    }),
                    arguments: {
                        COLOUR: {
                            type: ArgumentType.STRING,
                            defaultValue: 'black',
                            menu: "colour_options"
                        },                                                                           
                    }
                },                 
                {
                    opcode: 'background_colour',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.backgroundColour',
                        default: 'change the background colour to [COLOUR]',
                        description: 'change the background colour'
                    }),
                    arguments: {
                        COLOUR: {
                            type: ArgumentType.STRING,
                            defaultValue: 'cyan',
                            menu: "colour_options"
                        },                                                                           
                    }
                }, 
                {
                    opcode: 'backlight',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.backlight',
                        default: 'Set backlight to [INTENSITY]',
                        description: 'Set the display backlight intensity from 0 to 100'
                    }),
                    arguments: {
                        INTENSITY: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 80
                        }
                    }
                },
                {
                    opcode: 'preload_image',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.preloadImage',
                        default: 'preload [IMAGE] for use',
                        description: 'Load an image into memory for quick display'
                    }),
                    arguments: {
                        IMAGE: {
                            type: ArgumentType.STRING,
                            defaultValue: 'logo',
                            menu: 'preload_image_options'
                        }
                    }
                },
                {
                    opcode: 'clear',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.clear',
                        default: 'clear the screen',
                        description: 'clear the screen'
                    }),
                    arguments: {                                                                        
                    }
                },                                 
                '---',                          
                {
                    opcode: 'measure_left_encoder_count',
                    blockType: BlockType.REPORTER,
                   text: formatMessage({
                        id: 'tinkibot.measureLeftEncoderCount',
                        default: 'measure left encoder count',
                        description: 'Measure the left encoder count.'
                    }),
                    arguments: {
                    }
                }, 
                {
                    opcode: 'measure_right_encoder_count',
                    blockType: BlockType.REPORTER,
                   text: formatMessage({
                        id: 'tinkibot.measureRightEncoderCount',
                        default: 'measure right encoder count',
                        description: 'Measure the right encoder count.'
                    }),
                    arguments: {
                    }
                },                                               
                {
                    opcode: 'drive',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.drive',
                        default: 'drive [MOTOR] motor(s) at speed [SPEED]',
                        description: 'start the motors running at a particular speed'
                    }),
                    arguments: {
                        MOTOR: {
                            type: ArgumentType.STRING,
                            defaultValue: 'both',
                            menu: "motor_options"
                        },
                        SPEED: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 1
                        }                        
                    }
                },                                 
                {
                    opcode: 'stop',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.stop',
                        default: 'stop [MOTOR] motor(s)',
                        description: 'stop the motors'
                    }),
                    arguments: {
                        MOTOR: {
                            type: ArgumentType.STRING,
                            defaultValue: 'both',
                            menu: "motor_options"
                        },                      
                    }
                },                                 
                {
                    opcode: 'brake',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.brake',
                        default: 'brake [MOTOR] motor(s)',
                        description: 'apply brake to motors'
                    }),
                    arguments: {
                        MOTOR: {
                            type: ArgumentType.STRING,
                            defaultValue: 'both',
                            menu: "motor_options"
                        },                      
                    }
                },                                 
                '---',                          
                {
                    opcode: 'move',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.move',
                        default: 'move [DIRECTION] [DISTANCE] mm',
                        description: 'move the tinkibot'
                    }),
                    arguments: {
                        DIRECTION: {
                            type: ArgumentType.STRING,
                            defaultValue: 'forward',
                            menu: "direction_options"
                        },
                        DISTANCE: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 10
                        }                        
                    }
                },                                                   
                {
                    opcode: 'rotate',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.rotate',
                        default: 'rotate [ROTATION] [DEGREES] degrees',
                        description: 'rotate the tinkibot'
                    }),
                    arguments: {
                        ROTATION: {
                            type: ArgumentType.STRING,
                            defaultValue: 'clockwise',
                            menu: "rotation_options"
                        },
                        DEGREES: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 90
                        }                        
                    }
                },    
                {
                    opcode: 'arc',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.arc',
                        default: 'arc [DIRECTION] [DEGREES] degrees, radius [RADIUS]',
                        description: 'create an arc with the tinkibot'
                    }),
                    arguments: {
                        DIRECTION: {
                            type: ArgumentType.STRING,
                            defaultValue: 'left',
                            menu: "direction_options"
                        },
                        DEGREES: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 45
                        },
                        RADIUS: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 30
                        }                                                     
                    }
                },                                                                
                {
                    opcode: 'wiggle',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.wiggle',
                        default: 'wiggle [TIMES] times',
                        description: 'wiggle the tinkibot'
                    }),
                    arguments: {
                        TIMES: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 5
                        }                        
                    }
                }, 
                {
                    opcode: 'moonwalk',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.monwalk',
                        default: 'moonwalk [STEPS] steps',
                        description: 'make tinkibot moonwalk'
                    }),
                    arguments: {
                        STEPS: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 5
                        }                        
                    }
                },                                                                   
                {
                    opcode: 'fade',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'tinkibot.fade',
                        default: 'fade [TARGET] [DIRECTION] [SPEED]',
                        description: 'Fade the LEDs or display in or out.'
                    }),
                    arguments: {
                        TARGET: {type: ArgumentType.STRING, defaultValue: 'LEDs', menu: 'fade_target'},
                        DIRECTION: {type: ArgumentType.STRING, defaultValue: 'in', menu: 'fade_direction'},
                        SPEED: {type: ArgumentType.STRING, defaultValue: 'medium', menu: 'fade_speed'}
                    }
                }
            ],
            menus: {
                drum_options: {
                    acceptReporters: false,
                    items: [
                        {
                            value: '1',
                            text: formatMessage({
                                id: 'tinkibot.drum.snare',
                                default: 'Snare Drum',
                                description: 'Synthesized snare drum'
                            })
                        },
                        {
                            value: '2',
                            text: formatMessage({
                                id: 'tinkibot.drum.bass',
                                default: 'Bass Drum',
                                description: 'Synthesized bass drum'
                            })
                        },
                        {
                            value: '3',
                            text: formatMessage({
                                id: 'tinkibot.drum.sideStick',
                                default: 'Side Stick',
                                description: 'Synthesized side stick'
                            })
                        },
                        {
                            value: '5',
                            text: formatMessage({
                                id: 'tinkibot.drum.openHat',
                                default: 'Open Hi-Hat',
                                description: 'Synthesized open hi-hat'
                            })
                        },
                        {
                            value: '6',
                            text: formatMessage({
                                id: 'tinkibot.drum.closedHat',
                                default: 'Closed Hi-Hat',
                                description: 'Synthesized closed hi-hat'
                            })
                        },
                        {
                            value: '8',
                            text: formatMessage({
                                id: 'tinkibot.drum.clap',
                                default: 'Hand Clap',
                                description: 'Synthesized hand clap'
                            })
                        },
                        {
                            value: '11',
                            text: formatMessage({
                                id: 'tinkibot.drum.cowbell',
                                default: 'Cowbell',
                                description: 'Synthesized cowbell'
                            })
                        },
                        {
                            value: '12',
                            text: formatMessage({
                                id: 'tinkibot.drum.triangle',
                                default: 'Triangle',
                                description: 'Synthesized triangle'
                            })
                        }
                    ]
                },
                fade_speed: {acceptReporters: true, items: ['slow', 'medium', 'fast']},
                fade_target: {acceptReporters: false, items: ['LEDs', 'display']},
                fade_direction: {acceptReporters: false, items: ['in', 'out']},
                sound_options: {
                    acceptReporters: true,
                    items: ['startup', 'shutdown',"ugggh","growl","haha","sad",'charger','chicken',
                        'dog-barking','faart','spell','strum']
                },
                image_options: {
                    acceptReporters: true,
                    items: ['annoyed','biker','builder','embarassed',
                        'feeling-ill','indian','love','sad',
                        'logo', 'confused','happy','worried','game-over','scared']
                }, 
                letter_options: {
                    acceptReporters: true,
                    items: ['A', 'B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z']
                },                 
                number_options: {
                    acceptReporters: true,
                    items: ['0','1','2','3','4','5','6','7','8','9']
                },                 
                mosaic_options: {
                    acceptReporters: true,
                    items: ['logo', 'cowboy','indian','biker','buider']
                },  
                button_options: {
                    acceptReporters: true,
                    items: ['top-left', 'top-right','bottom-left','bottom-right']
                },                                 
                direction_options: {
                    acceptReporters: true,
                    items: ['forward', 'reverse']
                },    
                rotation_options: {
                    acceptReporters: true,
                    items: ['clockwise', 'anticlockwise']
                },  
                motor_options: {
                    acceptReporters: true,
                    items: ['right', 'left', 'both']
                }, 
                state_options: {
                    acceptReporters: true,
                    items: ['on', 'off']
                },
                button_state_options: {
                    acceptReporters: true,
                    items: ['pressed', 'released']
                },
                colour_options: {
                    acceptReporters: true,
                    items: ['red', 'yellow', 'pink','green','orange','purple','blue','cyan','black','white']
                }, 
                line_sensors_options: {
                    acceptReporters: true,
                    items: ['1','2','3','4','5','6','7']
                },                                                                                                           
            }
        };
        info.menus.preload_image_options = {
            acceptReporters: true,
            items: [...new Set([
                ...info.menus.image_options.items,
                ...info.menus.letter_options.items,
                ...info.menus.number_options.items,
                ...info.menus.mosaic_options.items
            ])]
        };
        info.blocks = info.blocks.map(block => {
            if (block === '---') return block;
            return Object.assign({}, block, {
                supportsBundling: block.blockType === BlockType.COMMAND && Boolean(robotActions[block.opcode])
            });
        });
        return info;
    }

















//---------------------------------------------------


    // helpers
    _disconnectProxy () {
        const socket = this._proxySocket;
        if (socket) {
            socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
            socket.close();
            if (window.socket === socket) window.socket = null;
            this._proxySocket = null;
        }
        if (this._connectionReject) this._connectionReject(new Error('Communication method changed'));
        this._connectionReject = null;
        this._connectionPromise = null;
        this._connected = false;
        this._pendingClaims.clear();
        this._pendingRemovals.clear();
        this._pendingReleases.clear();
        this._rejectPending(new Error('Communication method changed'), false);
        this._setConnectedRobots(this._connectedRobots.map(robot => ({...robot, connected: false})));
        this.connectionManager.reportProxy('disconnected');
    }

    connect () {
        return this.connectionManager.ensureConnected();
    }

    _connectProxy () {
        if (this._connected && this._proxySocket) return Promise.resolve();
        if (this._connectionPromise) return this._connectionPromise;

        window.socket = new WebSocket('ws://127.0.0.1:9006');
        this._proxySocket = window.socket;
        const socket = this._proxySocket;
        this.connectionManager.reportProxy('connecting');
        this._connectionPromise = new Promise((resolve, reject) => {
            this._connectionReject = reject;
            window.socket.onopen = () => {
                if (this._proxySocket !== socket || this.connectionManager.method !== 'local-proxy') return;
                this._connected = true;
                this._connectionReject = null;
                this.connectionManager.reportProxy('connected');
                resolve();
            };
        });

        window.socket.onclose = () => {
            if (this._proxySocket !== socket || this.connectionManager.method !== 'local-proxy') return;
            if (this._connectionReject) this._connectionReject(new Error('Local Proxy disconnected'));
            this._connectionReject = null;
            this.connectionManager.reportProxy('disconnected');
            this._connected = false;
            this._connectionPromise = null;
            this._pendingClaims.clear();
            this._pendingRemovals.clear();
            this._pendingReleases.clear();
            this._rejectPending(new Error('Tinkibot disconnected while waiting for a response'), false);
        };

        window.socket.onerror = () => {
            if (this._proxySocket !== socket || this.connectionManager.method !== 'local-proxy') return;
            this.connectionManager.reportProxy('error');
            if (this._pendingResponse) {
                this._rejectPending(new Error('Tinkibot connection failed'));
            }
        };
        window.socket.onmessage = message => {
            if (this._proxySocket !== socket || this.connectionManager.method !== 'local-proxy') return;
            this.connectionManager.log('rx', message.data);
            let response;
            try {
                response = JSON.parse(message.data);
                if (!response || typeof response !== 'object' || Array.isArray(response)) {
                    throw new Error('Expected a Tinkibot response object');
                }
            } catch (error) {
                // eslint-disable-next-line no-console -- A corrupt external frame must not strand a script.
                console.warn('TinkibotBlocks.connect: invalid WebSocket response', error);
                if (this._pendingResponse) {
                    this._rejectPending(new Error('Invalid Tinkibot JSON response'));
                }
                return;
            }
            this.connectionManager.log(response.event ? 'event' : 'parsed', response);
            if (this.connectionManager.method === 'local-proxy') this._handleRobotMessage(response);
        };

        return this._connectionPromise;
    }

    _handleRobotMessage (response) {
        if (response.event === 'connected_robots') {
            this._setConnectedRobots(response.robots || response.nicknames, true);
        } else if (response.event === 'robot_connected') {
            const known = this._connectedRobots.some(robot => robot.botUuid === response['bot-uuid']);
            this._setConnectedRobots(known ? this._connectedRobots.map(robot =>
                (robot.botUuid === response['bot-uuid'] ? {...robot,
                    nickname: response.nickname,
                    connected: true,
                    ...(response['claim-status'] ? {claimStatus: response['claim-status']} : {}),
                    claimedBy: Object.prototype.hasOwnProperty.call(response, 'client-uuid') ?
                        response['client-uuid'] : robot.claimedBy} : robot)) :
                [...this._connectedRobots, response]);
            this.runtime.emit('TINKIBOT_ROBOT_CONNECTION_CHANGED');
        } else if (response.event === 'robot_disconnected') {
            if (this._connectedRobots.some(robot => robot.botUuid === response['bot-uuid'])) {
                this._setConnectedRobots(this._connectedRobots.map(robot =>
                    (robot.botUuid === response['bot-uuid'] ? {...robot, connected: false} : robot)));
                this.runtime.emit('TINKIBOT_ROBOT_CONNECTION_CHANGED');
            }
        } else if (response.event === 'robot_removed') {
            this._pendingClaims.delete(response['bot-uuid']);
            this._pendingRemovals.delete(response['bot-uuid']);
            this._setConnectedRobots(this._connectedRobots.filter(robot => robot.botUuid !== response['bot-uuid']));
            this.runtime.emit('TINKIBOT_ROBOT_CONNECTION_CHANGED');
        } else if (response.event === 'claim_accepted') {
            if (this._claimResponseMatches(response)) {
                this._pendingClaims.delete(response['bot-uuid']);
                this._updateRobotClaim(response['bot-uuid'], response['client-uuid']);
            }
        } else if (response.event === 'claim_rejected') {
            if (this._claimResponseMatches(response)) {
                this._pendingClaims.delete(response['bot-uuid']);
                this._updateRobotClaim(response['bot-uuid'], null);
            }
        } else if (response.event === 'robot_released') {
            this._updateRobotClaim(response['bot-uuid'], null);
        }
        if (response.command === 'claim' && response.status === 'ERROR' &&
            response['client-uuid'] === this._clientUuid &&
            this._pendingClaims.get(response['bot-uuid']) === response['request-id']) {
            this._pendingClaims.delete(response['bot-uuid']);
            if (response.message === 'The robot has been claimed by another user') {
                this._updateRobotClaim(response['bot-uuid'], CLAIMED_BY_OTHER_USER);
                const robot = this._connectedRobots.find(item => item.botUuid === response['bot-uuid']);
                alert(formatMessage({
                    id: 'tinkibot.robotAlreadyClaimed',
                    default: '{nickname} could not be claimed because another user has already claimed it.',
                    description: 'Message shown when another user has already claimed a Tinkibot robot.'
                }, {nickname: robot.nickname}));
            } else {
                this._notifyCommandError(new Error(response.message));
                this._setConnectedRobots(this._connectedRobots);
            }
        }
        if (response.command === 'unclaim' && response['client-uuid'] === this._clientUuid &&
            this._pendingReleases.get(response['bot-uuid']) === response['request-id']) {
            this._pendingReleases.delete(response['bot-uuid']);
            if (response.status === 'OK') {
                this._pendingClaims.delete(response['bot-uuid']);
                this._updateRobotClaim(response['bot-uuid'], null);
            } else {
                this._notifyCommandError(new Error(response.message || 'Robot release failed'));
                this._setConnectedRobots(this._connectedRobots);
            }
        }
        if (response.event === 'button') {
            this._buttonEvent = response;
            this.runtime.startHats('tinkibotInteraction_when_button_event');
            this._buttonEvent = null;
        }
        if (response.command === 'remove' && response['client-uuid'] === this._clientUuid &&
            this._pendingRemovals.get(response['bot-uuid']) === response['request-id']) {
            this._pendingRemovals.delete(response['bot-uuid']);
            if (response.status === 'OK') {
                this._pendingClaims.delete(response['bot-uuid']);
                this._setConnectedRobots(this._connectedRobots.filter(robot =>
                    robot.botUuid !== response['bot-uuid']));
            } else {
                this._notifyCommandError(new Error(response.message));
                this._setConnectedRobots(this._connectedRobots);
            }
        }
        const pending = this._pendingResponse;
        if (pending && response.event === 'robot_disconnected' && response['bot-uuid'] === pending.botUuid) {
            this._rejectPending(new Error('Tinkibot disconnected while waiting for a response'), false);
            return;
        }
        if (!pending || response.event || response['request-id'] !== pending.requestId) return;
        try {
            const result = publicAPI.response(response, pending, this._clientUuid);
            if (pending.timeout) clearTimeout(pending.timeout);
            this._pendingResponse = null;
            pending.resolve(result);
        } catch (error) {
            this._rejectPending(error);
        }
    }

    _setConnectedRobots (robots, retainMissing = false) {
        // Explicit operation completion must re-enable controls even if no robot fields changed.
        const operationFinished = robots === this._connectedRobots;
        if (retainMissing) {
            const identities = new Set(robots.map(robot =>
                robot.botUuid || robot['bot-uuid'] || robot.nickname || robot));
            robots = [...robots, ...this._connectedRobots.filter(robot => robot.claimedBy &&
                !identities.has(robot.botUuid || robot.nickname)).map(robot => ({...robot, connected: false}))];
        }
        const reconciled = Array.from(new Map(robots.map(robot => {
            const normalizedRobot = typeof robot === 'string' ? {nickname: robot, botUuid: null, claimedBy: null} : {
                nickname: robot.nickname,
                ...((robot['claim-status'] || robot.claimStatus) ?
                    {claimStatus: robot['claim-status'] || robot.claimStatus} : {}),
                ...(robot.connected === false ? {connected: false} : {}),
                botUuid: robot.botUuid || robot['bot-uuid'] || null,
                claimedBy: robot.claimedBy || robot['client-uuid'] || robot.claimed_by || null
            };
            return [normalizedRobot.botUuid || normalizedRobot.nickname, normalizedRobot];
        })).values()).map(robot => Object.assign({}, robot, {
            claimState: robot.claimStatus === 'uncertain' ?
                (robot.claimedBy === this._clientUuid ? 'reserved' : 'confirmable') : robot.claimedBy ?
                    (robot.claimedBy === this._clientUuid ?
                        (robot.claimStatus === 'pending' ? 'pending' : 'paired') : 'claimed') : 'free'
        }));
        const previous = new Map(this._connectedRobots.map(robot => [robot.botUuid || robot.nickname, robot]));
        const stable = reconciled.map(robot => {
            const old = previous.get(robot.botUuid || robot.nickname);
            return old && JSON.stringify(old) === JSON.stringify(robot) ? old : robot;
        });
        if (!operationFinished && stable.length === this._connectedRobots.length &&
            stable.every((robot, index) => robot === this._connectedRobots[index])) return;
        this._connectedRobots = stable;
        this.runtime.tinkibotConnectedRobots = this._connectedRobots.map(robot => Object.assign({}, robot));
        this.runtime.emit('TINKIBOT_CONNECTED_ROBOTS_CHANGED', this.runtime.tinkibotConnectedRobots);
    }

    _updateRobotClaim (botUuid, clientUuid) {
        this._setConnectedRobots(this._connectedRobots.map(robot => (robot.botUuid === botUuid ?
            Object.assign({}, robot, {
                claimedBy: clientUuid,
                ...(this.connectionManager.method === 'web-serial' ?
                    {claimStatus: clientUuid ? 'accepted' : 'free'} : {})}) : robot)));
    }

    _claimResponseMatches (response) {
        const robot = this._connectedRobots.find(connectedRobot => connectedRobot.botUuid === response['bot-uuid']);
        return Boolean(robot &&
            robot.nickname === response.nickname &&
            response['client-uuid'] === this._clientUuid &&
            this._pendingClaims.has(response['bot-uuid']));
    }

    _getClientUuid () {
        const newId = () => uuid.v4();
        if (typeof window === 'undefined') return newId();
        try {
            const storage = window.localStorage;
            if (!storage) return newId();
            const storedId = storage.getItem(CLIENT_UUID_STORAGE_KEY);
            if (storedId) return storedId;
            const clientUuid = newId();
            storage.setItem(CLIENT_UUID_STORAGE_KEY, clientUuid);
            return clientUuid;
        } catch (error) {
            console.warn('TinkibotBlocks._getClientUuid: could not access local storage', error);
            return newId();
        }
    }

    _sendRobotRequest (payload) {
        const operation = this.connectionManager.sendRequest(payload);
        operation.catch(error => {
            if (this._pendingResponse && this._pendingResponse.requestId === payload['request-id']) {
                this._rejectPending(error);
            } else {
                this._pendingClaims.delete(payload['bot-uuid']);
                this._pendingRemovals.delete(payload['bot-uuid']);
                this._pendingReleases.delete(payload['bot-uuid']);
                this.connectionManager.log('error', error.message);
                this._setConnectedRobots(this._connectedRobots);
            }
        });
        return operation;
    }

    async claimRobot (botUuid) {
        const robot = this._connectedRobots.find(connectedRobot => connectedRobot.botUuid === botUuid);
        const alreadyClaimingOrPaired = this._pendingClaims.size > 0 ||
            this._connectedRobots.some(connectedRobot => connectedRobot.botUuid !== botUuid &&
                ['paired', 'pending', 'reserved'].includes(connectedRobot.claimState));
        if (!robot || robot.connected === false ||
            !['free', 'reserved', 'confirmable'].includes(robot.claimState) || alreadyClaimingOrPaired) return;
        await this.connect();
        const requestId = uuid.v4();
        this._pendingClaims.set(robot.botUuid, requestId);
        this._sendRobotRequest({
            'command': 'claim',
            'request-id': requestId,
            'nickname': robot.nickname,
            'bot-uuid': robot.botUuid,
            'client-uuid': this._clientUuid
        });
    }

    async releaseRobot (botUuid) {
        const robot = this._connectedRobots.find(connectedRobot => connectedRobot.botUuid === botUuid);
        if (!robot || !['paired', 'pending', 'reserved'].includes(robot.claimState)) return;
        await this.connect();
        const requestId = uuid.v4();
        this._pendingReleases.set(botUuid, requestId);
        this._sendRobotRequest({
            'command': 'unclaim',
            'request-id': requestId,
            'nickname': robot.nickname,
            'bot-uuid': robot.botUuid,
            'client-uuid': this._clientUuid
        });
        if (this.connectionManager.method === 'local-proxy') this._updateRobotClaim(robot.botUuid, null);
    }

    async removeRobot (botUuid) {
        const robot = this._connectedRobots.find(item => item.botUuid === botUuid);
        if (!robot || robot.claimState === 'claimed' || this._pendingRemovals.has(botUuid)) return;
        await this.connect();
        const requestId = uuid.v4();
        this._pendingRemovals.set(botUuid, requestId);
        this._sendRobotRequest({'command': 'remove',
            'request-id': requestId,
            'client-uuid': this._clientUuid,
            'bot-uuid': botUuid});
    }

    _sendBundle (plan, thread) {
        return this._sendCommand({}, 'bundle', plan, thread);
    }

    _notifyCommandError (error) {
        const message = error.message === 'command_failed:no_robots_connected' ?
            formatMessage({
                id: 'tinkibot.noRobotsConnected',
                default: 'No Tinkibot robots are connected.',
                description: 'Message shown when a command needs a connected Tinkibot.'
            }) : formatMessage({
                id: 'tinkibot.commandError',
                default: 'Tinkibot command failed: {error}',
                description: 'Message shown when a Tinkibot command cannot be completed.'
            }, {error: error.message});
        alert(message);
    }

    _rejectPending (error, notify = true) {
        const pending = this._pendingResponse;
        if (!pending) return;
        this._pendingResponse = null;
        if (pending.timeout) clearTimeout(pending.timeout);
        if (notify) this._notifyCommandError(error);
        pending.reject(error);
    }

    _bundleConnection () {
        const connection = this.connect();
        if (this._connected) return connection;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const error = new Error('Tinkibot bundle connection timed out');
                this._notifyCommandError(error);
                reject(error);
            }, bundleProtocol.TIMEOUT_MS);
            connection.then(() => {
                clearTimeout(timeout);
                resolve();
            }, error => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    _sendCommand (command, responseCommand = command.command, bundlePlan = null, sourceThread = null) {
        this._queuedCommands++;
        const operation = this._commandQueue.then(async () => {
            if (sourceThread && !sourceThread.stack.length) throw new Error('Tinkibot script stopped before dispatch');
            const robot = this._connectedRobots.find(connectedRobot => connectedRobot.claimState === 'paired');
            if (!robot) {
                const message = formatMessage({
                    id: 'tinkibot.robotClaimRequired',
                    default: 'Claim a robot from the Connections tab before using Tinkibot blocks.',
                    description: 'Message shown when a Tinkibot block is used without a claimed robot.'
                });
                alert(message);
                throw new Error('No Tinkibot robot is claimed');
            }
            if (robot.connected === false) {
                const error = new Error('Tinkibot is disconnected; reconnect or remove it from My robots');
                this._notifyCommandError(error);
                throw error;
            }
            let payload = publicAPI.command(command);
            if (bundlePlan) {
                payload = {cmds: bundlePlan.map(item => publicAPI.command(item.payload))};
                await this._bundleConnection();
            } else {
                await this.connect();
            }
            if (sourceThread && !sourceThread.stack.length) throw new Error('Tinkibot script stopped before dispatch');
            return new Promise((resolve, reject) => {
                const requestId = uuid.v4();
                const pending = {command: responseCommand,
                    requestId,
                    resolve,
                    reject,
                    botUuid: robot.botUuid,
                    publicCommands: bundlePlan ? payload.cmds : [payload]};
                if (bundlePlan) {
                    pending.bundleCommands = bundlePlan.map(item =>
                        `${robot.nickname}.${robotActions[item.opcode].encode(item.payload)}`);
                    pending.timeout = setTimeout(() => {
                        if (this._pendingResponse === pending) {
                            this._rejectPending(new Error('Tinkibot bundle response timed out'));
                        }
                    }, bundleProtocol.responseTimeout(bundlePlan));
                }
                if (!bundlePlan) {
                    pending.timeout = setTimeout(() => {
                        if (this._pendingResponse === pending) {
                            this._rejectPending(new Error('Tinkibot response timed out'));
                        }
                    }, bundleProtocol.TIMEOUT_MS + ((Number(command.duration) || 0) * 1000));
                }
                this._pendingResponse = pending;
                try {
                    this._sendRobotRequest(Object.assign({}, payload, {
                        'request-id': requestId,
                        'nickname': robot.nickname,
                        'bot-uuid': robot.botUuid,
                        'client-uuid': this._clientUuid
                    }));
                } catch (error) {
                    this._rejectPending(error);
                }
            });
        });
        const tracked = operation.finally(() => {
            this._queuedCommands--;
        });
        this._commandQueue = tracked.catch(() => {});
        return tracked;
    }

    // reporter blocks

    measure_distance () {
        return this._sendCommand({command: 'measure_distance'});
    }

    measure_voltage () {
        return this._sendCommand({command: 'measure_voltage'});
    }

    measure_right_encoder_count () {
        return this._sendCommand({command: 'measure_enc_right'});
    }

    measure_left_encoder_count () {
        return this._sendCommand({command: 'measure_enc_left'});
    }

    read_button (args) {
        return this._sendCommand({command: 'read_button', button: args.BUTTON});
    }

    when_button_event (args) {
        return Boolean(this._buttonEvent &&
            this._buttonEvent.button === args.BUTTON &&
            this._buttonEvent.state === args.STATE);
    }

    button_led (args, util) {
        return this._bundler.run('button_led', args, util);
    }

    play_sound (args, util) {
        return this._bundler.run('play_sound', args, util);
    }

    playNoteForBeats (args, util) {
        return this._bundler.run('playNoteForBeats', args, util);
    }

    playDrumForBeats (args, util) {
        return this._bundler.run('playDrumForBeats', args, util);
    }


    restForBeats (args, util) {
        this._music.rest(args.BEATS, util);
    }

    setTempo (args) {
        this._music.setTempo(args.TEMPO);
    }

    changeTempo (args) {
        this._music.setTempo(this._music.getTempo() + Cast.toNumber(args.TEMPO));
    }

    preload_audio (args, util) {
        return this._bundler.run('preload_audio', args, util);
    }

    preload_image (args, util) {
        return this._bundler.run('preload_image', args, util);
    }

    display_image (args, util) {
        return this._bundler.run('display_image', args, util);
    }

    measure_line_sensor (args) {
        return this._sendCommand({command: 'measure_line_sensor', sensor: args.SENSOR});
    }

    display_letter (args, util) {
        return this._bundler.run('display_letter', args, util);
    }

    display_number (args, util) {
        return this._bundler.run('display_number', args, util);
    }

    write_text (args, util) {
        return this._bundler.run('write_text', args, util);
    }

    text_colour (args, util) {
        return this._bundler.run('text_colour', args, util);
    }

    background_colour (args, util) {
        return this._bundler.run('background_colour', args, util);
    }

    clear (args, util) {
        return this._bundler.run('clear', args, util);
    }

    backlight (args, util) {
        return this._bundler.run('backlight', args, util);
    }

    mosaic (args, util) {
        return this._bundler.run('mosaic', args, util);
    }

    move (args, util) {
        return this._bundler.run('move', args, util);
    }

    rotate (args, util) {
        return this._bundler.run('rotate', args, util);
    }

    arc (args, util) {
        return this._bundler.run('arc', args, util);
    }

    volume (args, util) {
        return this._bundler.run('volume', args, util);
    }

    drive (args, util) {
        return this._bundler.run('drive', args, util);
    }

    stop (args, util) {
        return this._bundler.run('stop', args, util);
    }

    brake (args, util) {
        return this._bundler.run('brake', args, util);
    }

    fade (args, util) {
        return this._bundler.run('fade', args, util);
    }

    wiggle (args, util) {
        return this._bundler.run('wiggle', args, util);
    }

    moonwalk (args, util) {
        return this._bundler.run('moonwalk', args, util);
    }

    _setLocale () {
        let now_locale = '';
        switch (formatMessage.setup().locale){
            case 'pt-br':
            case 'pt':
                now_locale='pt-br';
                break;
            case 'en':
                now_locale='en';
                break;
            case 'fr':
                now_locale='fr';
                break;
            case 'zh-tw':
                now_locale= 'zh-tw';
                break;
            case 'zh-cn':
                now_locale= 'zh-cn';
                break;
            case 'pl':
                now_locale= 'pl';
                break;
            case 'ja':
                now_locale= 'ja';
                break;
            case 'de':
                now_locale= 'de';
                break;
            case 'nl':
                now_locale= 'nl';
                break;
            default:
                now_locale='en';
                break;
        }
        return now_locale;
    }
}
module.exports = TinkibotBlocks;
